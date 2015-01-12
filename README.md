# [gulp](https://github.com/gulpjs/gulp)-awslambda
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

`lambda_params` can either be a string or an object of parameters defining the Lambda function (the same as you would pass to [`uploadFunction()`](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#uploadFunction-property)). If it is a string, gulp-awslambda assumes the function already exists and attempts to download its existing configuration.

### Example Project

See the `example/` directory for a full working example.

## API

```js
lambda(lambda_params, opts)
```

### `lambda_params`

### `opts`
