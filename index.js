'use strict';
var AWS = require('aws-sdk');
var gutil = require('gulp-util');
var through = require('through2');
var extend = require('xtend');

module.exports = function(params, opts) {
	opts = extend({
		profile: null,
		region: 'us-east-1'
	}, opts);

	var toUpload;
	var functionName = typeof params === 'string'? params : params.FunctionName;

	var make_err = function(message) {
		return new gutil.PluginError('gulp-awslambda', message);
	};

	return through.obj(function(file, enc, cb) {
		if (file.isNull()) {
			cb();
			return;
		}
		if (file.isStream()) {
			cb(make_err('Streaming is not supported'));
			return;
		}
		if (!toUpload) {
			toUpload = file;
		}
		cb();
	}, function(cb) {
		if (!toUpload) {
			cb(make_err('No file provided'));
			return;
		}
		if (toUpload.path.slice(-4) !== '.zip') {
			cb(make_err('Provided file is not a ZIP'));
			return;
		}

		gutil.log('Uploading Lambda function "' + functionName + '"...');

		if (opts.profile !== null) {
			AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: opts.profile });
		}

		AWS.config.update({ region: opts.region });

		var lambda = new AWS.Lambda();
		var stream = this;

		var done = function(err) {
			if (err) {
				cb(make_err(err.message));
				return;
			}
			gutil.log('Lambda function "' + functionName + '" successfully uploaded');
			stream.push(toUpload);
			cb();
		};

		if (typeof params === 'string') {
			// Just updating code
			lambda.updateFunctionCode({
				FunctionName: params,
				ZipFile: toUpload.contents
			}, done);
		} else {
			lambda.getFunctionConfiguration({
				FunctionName: params.FunctionName
			}, function(err) {
				if (err) {
					// Creating a function
					lambda.createFunction(extend({
						Handler: 'index.handler',
						Runtime: 'nodejs'
					}, params, {
						Code: {
							ZipFile: toUpload.contents
						}
					}), done);
				} else {
					// Updating code + config
					lambda.updateFunctionCode({
						FunctionName: params.FunctionName,
						ZipFile: toUpload.contents
					}, function(err) {
						if (err) {
							done(err);
							return;
						}
						lambda.updateFunctionConfiguration(params, done);
					});
				}
			});
		}
	});
};
