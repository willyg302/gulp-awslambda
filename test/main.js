'use strict';
var proxyquire = require('proxyquire');
var should = require('should');
var sinon = require('sinon');

var gulp = require('gulp');
var gutil = require('gulp-util');
var path = require('path');
var AWS = require('aws-sdk');


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
		// createFunction and updateFunction need special handling because they
		// are used as AWS.Request factories.
		if (method === 'createFunction' || method === 'updateFunctionCode') {
			var sendStub = sandbox.stub(AWS.Request.prototype, 'send')
				.callsFake(function(cb) { cb(); });
			var onStub = sandbox.stub(AWS.Request.prototype, 'on');
			onStub.returns(AWS.Request.prototype);
			onStub.yields(methods[method]);
			mocked[method] = sandbox.stub();
			mocked[method].returns(AWS.Request.prototype);
		} else {
			mocked[method] = sandbox.stub();
			mocked[method].yields(methods[method]);
		}
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

	it('should update the function runtime if provided', function(done) {
		var mocked = lambdaPlugin(sandbox, {
			'getFunctionConfiguration': null,
			'updateFunctionCode': null,
			'updateFunctionConfiguration': null,
		});
		mock(sandbox, {
			stream: mocked.plugin({ FunctionName: 'bar', Runtime: 'nodejs6.10' }),
			fixture: 'hello.zip',
			contents: 'test updateFunctionConfiguration',
		}, done, function(file) {
			mocked.methods.updateFunctionConfiguration.firstCall.args[0].should.eql({
				FunctionName: 'bar',
				Runtime: 'nodejs6.10',
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
		var mocked = lambdaPlugin(sandbox, {
			'updateFunctionCode': { data: { Version: 1 } },
		});
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
			'createFunction': null
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

	it('should error on alias specified without name', function(done) {
		var mocked = lambdaPlugin(sandbox);
		gulp.src(fixtures('hello.zip'), {buffer: true})
			.pipe(mocked.plugin('someFunction', { publish: true, alias: {} }))
			.on('error', function(err) {
				err.message.should.eql('Alias requires a \u001b[31mname\u001b[39m parameter');
				done();
			});
	});

	it('should error if specified alias name is not a string', function(done) {
		var mocked = lambdaPlugin(sandbox);
		gulp.src(fixtures('hello.zip'), {buffer: true})
			.pipe(mocked.plugin('someFunction', { publish: true, alias: { name: 5 } }))
			.on('error', function(err) {
				err.message.should.eql('Alias \u001b[31mname\u001b[39m must be a string');
				done();
			});
	});

	it('should create an alias if necessary', function(done) {
		var mocked = lambdaPlugin(sandbox, {
			'updateFunctionCode': { data: { Version: 1 } },
			'getAlias': true,  // Cause an error
			'createAlias': null,
		});
		mock(sandbox, {
			stream: mocked.plugin('someFunction', { publish: true, alias: { name: 'alias' } }),
			fixture: 'hello.zip',
			contents: 'test updateFunctionCode',
		}, done, function(file) {
			mocked.methods.getAlias.firstCall.args[0].should.eql({
				FunctionName: 'someFunction',
				Name: 'alias',
			});
			mocked.methods.createAlias.firstCall.args[0].should.eql({
				FunctionName: 'someFunction',
				FunctionVersion: '1',
				Name: 'alias',
				Description: undefined,
			});
		});
	});

	it('should update an alias if necessary', function(done) {
		var mocked = lambdaPlugin(sandbox, {
			'updateFunctionCode': { data: { Version: 1 } },
			'getAlias': null,
			'updateAlias': null,
		});
		// Also test all alias options
		var alias = { name: 'alias', description: 'my alias', version: 42 };
		mock(sandbox, {
			stream: mocked.plugin('someFunction', { publish: true, alias: alias }),
			fixture: 'hello.zip',
			contents: 'test updateFunctionCode',
		}, done, function(file) {
			mocked.methods.updateAlias.firstCall.args[0].should.eql({
				FunctionName: 'someFunction',
				FunctionVersion: '42',
				Name: 'alias',
				Description: 'my alias',
			});
		});
	});
});
