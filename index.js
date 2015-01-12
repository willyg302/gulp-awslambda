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

	var make_err = function(message) {
		return new gutil.PluginError('gulp-awslambda', message);
	};

	var upload = function(lambda, configuration, stream, cb) {
		configuration = extend(configuration, {FunctionZip: toUpload.contents});
		lambda.uploadFunction(configuration, function(err, data) {
			if (err) {
				cb(make_err(err.message));
				return;
			}
			gutil.log('Lambda function successfully uploaded');
			stream.push(toUpload);
			cb();
		});
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

		gutil.log('Uploading Lambda function...');

		if (opts.profile !== null) {
			AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: opts.profile});
		}

		AWS.config.update({region: opts.region});

		var lambda = new AWS.Lambda();
		var stream = this;

		if (typeof params === 'string') {
			lambda.getFunctionConfiguration({FunctionName: params}, function(err, data) {
				if (err) {
					if (err.statusCode === 404) {
						cb(make_err("Unable to find the Lambda function " + params));
					} else {
						cb(make_err('AWS API request failed, check your AWS credentials are correct'));
					}
					return;
				}
				delete data.CodeSize;
				delete data.ConfigurationId;
				delete data.FunctionARN;
				delete data.LastModified;
				upload(lambda, data, stream, cb);
			});
		} else {
			upload(lambda, extend({
				Handler: 'index.handler',
				Mode: 'event',
				Runtime: 'nodejs'
			}, params), stream, cb);
		}
	});
};
