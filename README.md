# [gulp](https://github.com/gulpjs/gulp)-awslambda

[![Travis](https://img.shields.io/travis/willyg302/gulp-awslambda.svg?style=flat-square)](https://travis-ci.org/willyg302/gulp-awslambda)
[![license](http://img.shields.io/badge/license-MIT-red.svg?style=flat-square)](https://raw.githubusercontent.com/willyg302/gulp-awslambda/master/LICENSE)

> A Gulp plugin for publishing your package to AWS Lambda

## Install

```bash
$ npm install --save-dev gulp-awslambda
```

## Usage

### AWS Credentials

It is recommended that you store your AWS Credentials in `~/.aws/credentials` as per [the docs](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html#Credentials_from_the_Shared_Credentials_File_____aws_credentials_).

### Basic Workflow

gulp-awslambda accepts a single ZIP file, uploads that to AWS Lambda, and passes it on down the stream. It works really well with [gulp-zip](https://github.com/sindresorhus/gulp-zip):

```js
var gulp   = require('gulp');
var lambda = require('gulp-awslambda');
var zip    = require('gulp-zip');

gulp.task('default', function() {
	return gulp.src('index.js')
		.pipe(zip('archive.zip'))
		.pipe(lambda(lambda_params, opts))
		.pipe(gulp.dest('.'));
});
```

For more information on `lambda_params` and `opts` see the [API section](#api).

### Example Project

See the `example/` directory of this repo for a full working example.

## API

```js
lambda(lambda_params, opts)
```

### `lambda_params`

Parameters describing the Lambda function. This can either be...

#### A String

corresponding to the name of an existing Lambda function. In this case gulp-awslambda will only update the function's code.

#### An Object

that is mostly the same as you would pass to [`updateFunctionConfiguration()`](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#updateFunctionConfiguration-property). The only required parameters are `FunctionName` and `Role`. All the other parameters have the following default values:

- `Handler = 'index.handler'`: This assumes a valid `exports.handler` in `index.js` at the root of your ZIP
- `Runtime = 'nodejs'`: Currently the only supported runtime

gulp-awslambda will perform an *upsert*, meaning the function will be created if it does not already exist, and updated (both code and configuration) otherwise.

For code, gulp-awslambda will default to passing the `ZipFile` property. However, you may alternatively pass e.g.:

```js
Code: {
	S3Bucket: 'myBucket',
	S3Key: 'function.zip',
},
...
```

to upload from S3.

### `opts`

Options configuring the AWS environment to be used when uploading the function. The following options are supported:

#### `profile`

If you [use a different credentials profile](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html#Using_Profiles_with_the_SDK), you can specify its name with this option.

#### `publish`

Allows you to publish a new version when passing in a string for `lambda_params`. Otherwise, you may simply specify `Publish` as a parameter. If both are provided, the value in `lambda_params` will take precedence.

#### `region = 'us-east-1'`

Set your AWS region.
