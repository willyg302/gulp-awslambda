'use strict';
var AWS = require('aws-sdk');
var gutil = require('gulp-util');
var through = require('through2');
var extend = require('xtend');


var DEFAULT_OPTS = {
	profile: null,
	region: 'us-east-1'
};

var DEFAULT_PARAMS = {
	Handler: 'index.handler',
	Runtime: 'nodejs4.3'
};


var makeErr = function(message) {
	return new gutil.PluginError('gulp-awslambda', message);
};

var updateFunctionCode = function(lambda, name, upload, params, opts) {
	delete params.Runtime;
	var code = params.Code || { ZipFile: upload.contents };
	return lambda.updateFunctionCode(extend({
		FunctionName: name
	}, code, {
		Publish: opts.publish || false
	}));
};

var createFunction = function(lambda, upload, params, opts) {
	params.Code = params.Code || { ZipFile: upload.contents };
	return lambda.createFunction(extend(DEFAULT_PARAMS, {
		Publish: opts.publish || false
	}, params));
};

var upsertAlias = function(operation, lambda, functionName, functionVersion, alias, aliasDescription) {
	var params = {
		FunctionName: functionName,
		FunctionVersion: functionVersion,
		Name: alias,
		Description: aliasDescription
	};
	lambda[operation + 'Alias'](params, function(err) {
		if (err) {
			gutil.log('Could not ' + operation + ' alias ' + alias + ':' + err);
		} else {
			gutil.log(operation + 'd alias ' + gutil.colors.magenta(alias) + ' for version ' +
				gutil.colors.magenta(functionVersion));
		}
	});
};


module.exports = function(params, opts) {
	opts = extend(DEFAULT_OPTS, opts);

	AWS.config.update({ region: opts.region });

	if (opts.profile !== null) {
		AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: opts.profile });
	}

	var lambda = new AWS.Lambda();
	var toUpload;
	var functionName = typeof params === 'string' ? params : params.FunctionName;

	var updateOrCreateAlias = function(response) {
		if (opts.publish && opts.alias) {
			lambda.getAlias({
				FunctionName: functionName,
				Name: opts.alias.name
			}, function(err) {
				var operation = err ? 'create' : 'update';
				upsertAlias(operation, lambda, functionName,
					(opts.alias.version || response.data.Version).toString(),
					opts.alias.name,
					opts.alias.description);
			});
		}
	};
	var printVersion = function(response) {
		if (opts.publish) {
			gutil.log('Publishing Function Version: ' + gutil.colors.magenta(response.data.Version));
		}
	};
	var successfulUpdate = function(response) {
		printVersion(response);
		updateOrCreateAlias(response);
	};
	var successfulCreation = function(response) {
		printVersion(response);
		updateOrCreateAlias(response);
	};

	var transform = function(file, enc, cb) {
		if (file.isNull()) {
			return cb();
		}
		if (file.isStream()) {
			return cb(makeErr('Streaming is not supported'));
		}
		if (!toUpload) {
			toUpload = file;
		}
		cb();
	};

	var flush = function(cb) {
		if (!toUpload && (typeof params === 'string' || !params.Code)) {
			return cb(makeErr('No code provided'));
		}
		if (toUpload && toUpload.path.slice(-4) !== '.zip') {
			return cb(makeErr('Provided file is not a ZIP'));
		}
		if (opts.alias) {
			if (!opts.alias.name) {
				return cb(makeErr('Alias requires a ' + gutil.colors.red('name') + ' parameter'));
			} else if (!(typeof opts.alias.name === 'string')) {
				return cb(makeErr('Alias ' + gutil.colors.red('name') + ' must be a string'));
			}
		}

		gutil.log('Uploading Lambda function "' + functionName + '"...');

		var stream = this;

		var done = function(err) {
			if (err) {
				return cb(makeErr(err.message));
			}
			gutil.log('Lambda function "' + functionName + '" successfully uploaded');
			stream.push(toUpload);
			cb();
		};

		if (typeof params === 'string') {
			// Just updating code
			updateFunctionCode(lambda, params, toUpload, params, opts)
				.on('success', successfulUpdate)
				.send(done);
		} else {
			lambda.getFunctionConfiguration({
				FunctionName: params.FunctionName
			}, function(err) {
				if (err) {
					// Creating a function
					createFunction(lambda, toUpload, params, opts)
						.on('success', successfulCreation)
						.send(done);
				} else {
					// Updating code + config
					var runtime = params.Runtime;
					updateFunctionCode(lambda, params.FunctionName, toUpload, params, opts)
						.on('success', successfulUpdate)
						.send(function() {
							delete params.Code;
							if (runtime) {
								params.Runtime = runtime;
							}
							lambda.updateFunctionConfiguration(params, done);
						});
				}
			});
		}
	};

	return through.obj(transform, flush);
};
