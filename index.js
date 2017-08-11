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

var updateFunctionCode = function(lambda, name, upload, params, opts, cb) {
	delete params.Runtime;
	var code = params.Code || { ZipFile: upload.contents };
	lambda.updateFunctionCode(extend({
		FunctionName: name
	}, code, {
		Publish: opts.publish || false
	}), cb);
};

var createFunction = function(lambda, upload, params, opts, cb) {
	params.Code = params.Code || { ZipFile: upload.contents };
	lambda.createFunction(extend(DEFAULT_PARAMS, {
		Publish: opts.publish || false
	}, params), cb);
};


module.exports = function(params, opts) {
	opts = extend(DEFAULT_OPTS, opts);

	var toUpload;
	var functionName = typeof params === 'string'? params : params.FunctionName;

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

		gutil.log('Uploading Lambda function "' + functionName + '"...');

		if (opts.profile !== null) {
			AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: opts.profile });
		} else if(opts.credentials !== null) {
			AWS.config.credentials = new AWS.Credentials(opts.credentials.key, opts.credentials.secret);
		}


		AWS.config.update({ region: opts.region });

		var lambda = new AWS.Lambda();
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
			updateFunctionCode(lambda, params, toUpload, params, opts, done);
		} else {
			lambda.getFunctionConfiguration({
				FunctionName: params.FunctionName
			}, function(err) {
				if (err) {
					// Creating a function
					createFunction(lambda, toUpload, params, opts, done);
				} else {
					// Updating code + config
					updateFunctionCode(lambda, params.FunctionName, toUpload, params, opts, function(err) {
						if (err) {
							return done(err);
						}
						delete params.Code;
						lambda.updateFunctionConfiguration(params, done);
					});
				}
			});
		}
	};

	return through.obj(transform, flush);
};
