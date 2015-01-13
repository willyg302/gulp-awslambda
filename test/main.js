'use strict';
var lambdaPlugin = require('../');
var should = require('should');
var sinon = require('sinon');
var gulp = require('gulp');
var path = require('path');
var AWS = require('aws-sdk');


var fixtures = function(glob) {
	return path.join(__dirname, 'fixtures', glob);
};


describe('gulp-awslambda', function() {
	it('should error if no file is provided', function(done) {
		gulp.src('fake.zip')
			.pipe(lambdaPlugin('someFunction'))
			.on('error', function(err) {
				err.message.should.eql('No file provided');
				done();
			});
	});

	it('should error on streamed file', function(done) {
		gulp.src(fixtures('hello.zip'), {buffer: false})
			.pipe(lambdaPlugin('someFunction'))
			.on('error', function(err) {
				err.message.should.eql('Streaming is not supported');
				done();
			});
	});

	it('should only accept ZIP files', function(done) {
		gulp.src(fixtures('index.js'))
			.pipe(lambdaPlugin('someFunction'))
			.on('error', function(err) {
				err.message.should.eql('Provided file is not a ZIP');
				done();
			});
	});
});
