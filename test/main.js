'use strict';
var proxyquire = require('proxyquire');
var should = require('should');
var sinon = require('sinon');

var gulp = require('gulp');
var gutil = require('gulp-util');
var path = require('path');


var fixtures = function(glob) {
	return path.join(__dirname, 'fixtures', glob);
};

var mock = function(sandbox, args, done, cb) {
	var stream = args.stream;

	stream.write(new gutil.File({
		path: fixtures(args.fixture),
		contents: new Buffer(args.contents),
	}));

	stream.on('data', cb);
	stream.on('end', done);
	stream.end();
};

var lambdaPlugin = function(sandbox, methods) {
	methods = methods || {};
	var mocked = {};
	Object.keys(methods).forEach(function(method) {
		mocked[method] = sandbox.stub();
		mocked[method].yields(methods[method]);
	});
	var plugin = proxyquire('../', {
		'aws-sdk': {
			Lambda: function() {
				return mocked;
			},
		},
	});
	return {
		methods: mocked,
		plugin: plugin,
	};
};


describe('gulp-awslambda', function() {
	var sandbox, log;

	beforeEach(function() {
		sandbox = sinon.sandbox.create();
		log = gutil.log;
		gutil.log = gutil.noop;
	});

	afterEach(function() {
		gutil.log = log;
		sandbox.restore();
	});


	it('should error if no code is provided for string params', function(done) {
		var mocked = lambdaPlugin(sandbox);
		gulp.src('fake.zip')
			.pipe(mocked.plugin('someFunction'))
			.on('error', function(err) {
				err.message.should.eql('No code provided');
				done();
			});
	});

	it('should error if no code is provided for object params', function(done) {
		var mocked = lambdaPlugin(sandbox);
		gulp.src('fake.zip')
			.pipe(mocked.plugin({ FunctionName: 'someFunction' }))
			.on('error', function(err) {
				err.message.should.eql('No code provided');
				done();
			});
	});

	it('should error on streamed file', function(done) {
		var mocked = lambdaPlugin(sandbox);
		gulp.src(fixtures('hello.zip'), {buffer: false})
			.pipe(mocked.plugin('someFunction'))
			.on('error', function(err) {
				err.message.should.eql('Streaming is not supported');
				done();
			});
	});

	it('should only accept ZIP files', function(done) {
		var mocked = lambdaPlugin(sandbox);
		gulp.src(fixtures('index.js'))
			.pipe(mocked.plugin('someFunction'))
			.on('error', function(err) {
				err.message.should.eql('Provided file is not a ZIP');
				done();
			});
	});

	it('should update code if passed a string', function(done) {
		var mocked = lambdaPlugin(sandbox, { 'updateFunctionCode': null });
		mock(sandbox, {
			stream: mocked.plugin('someFunction'),
			fixture: 'hello.zip',
			contents: 'test updateFunctionCode',
		}, done, function(file) {
			path.normalize(file.path).should.eql(fixtures('hello.zip'));
			mocked.methods.updateFunctionCode.called.should.eql(true);
			mocked.methods.updateFunctionCode.firstCall.args[0].should.eql({
				FunctionName: 'someFunction',
				ZipFile: file.contents,
				Publish: false,
			});
		});
	});

	it('should create the function if it does not exist', function(done) {
		var mocked = lambdaPlugin(sandbox, {
			'getFunctionConfiguration': true,  // Cause an error
			'createFunction': null,
		});
		mock(sandbox, {
			stream: mocked.plugin({ FunctionName: 'foo' }),
			fixture: 'hello.zip',
			contents: 'test createFunction',
		}, done, function(file) {
			mocked.methods.getFunctionConfiguration.called.should.eql(true);
			mocked.methods.createFunction.firstCall.args[0].should.eql({
				FunctionName: 'foo',
				Code: {
					ZipFile: file.contents,
				},
				Handler: 'index.handler',
				Runtime: 'nodejs4.3',
				Publish: false,
			});
		});
	});

	it('should update the function if it already exists', function(done) {
		var mocked = lambdaPlugin(sandbox, {
			'getFunctionConfiguration': null,
			'updateFunctionCode': null,
			'updateFunctionConfiguration': null,
		});
		mock(sandbox, {
			stream: mocked.plugin({ FunctionName: 'bar' }),
			fixture: 'hello.zip',
			contents: 'test updateFunctionConfiguration',
		}, done, function(file) {
			mocked.methods.getFunctionConfiguration.called.should.eql(true);
			mocked.methods.updateFunctionCode.firstCall.args[0].should.eql({
				FunctionName: 'bar',
				ZipFile: file.contents,
				Publish: false,
			});
			mocked.methods.updateFunctionConfiguration.firstCall.args[0].should.eql({
				FunctionName: 'bar',
			});
		});
	});

	it('should allow providing code from S3', function(done) {
		var mocked = lambdaPlugin(sandbox, {
			'getFunctionConfiguration': true,  // Cause an error
			'createFunction': null,
		});
		mock(sandbox, {
			stream: mocked.plugin({
				FunctionName: 'foo',
				Code: {
					S3Bucket: 'myBucket',
					S3Key: 'function.zip',
				},
			}),
			fixture: 'hello.zip',
			contents: 'test createFunction',
		}, done, function(file) {
			mocked.methods.createFunction.firstCall.args[0].Code.should.eql({
				S3Bucket: 'myBucket',
				S3Key: 'function.zip',
			});
		});
	});

	it('should allow publishing for update from a string', function(done) {
		var mocked = lambdaPlugin(sandbox, { 'updateFunctionCode': null });
		mock(sandbox, {
			stream: mocked.plugin('someFunction', { publish: true }),
			fixture: 'hello.zip',
			contents: 'test updateFunctionCode',
		}, done, function(file) {
			mocked.methods.updateFunctionCode.firstCall.args[0].Publish.should.eql(true);
		});
	});

	it('should favor Publish from params over opts', function(done) {
		var mocked = lambdaPlugin(sandbox, {
			'getFunctionConfiguration': true,  // Cause an error
			'createFunction': null,
		});
		mock(sandbox, {
			stream: mocked.plugin({
				FunctionName: 'foo',
				Publish: true,
			}, { publish: false }),
			fixture: 'hello.zip',
			contents: 'test createFunction',
		}, done, function(file) {
			mocked.methods.createFunction.firstCall.args[0].Publish.should.eql(true);
		});
	});
});
