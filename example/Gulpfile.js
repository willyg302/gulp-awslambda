var gulp   = require('gulp');
var lambda = require('gulp-awslambda');
var zip    = require('gulp-zip');


/**
 * For uploading the first time.
 * Subsequent updates on a function that has already been created only
 * require the name of the function (see task below).
 */
var lambda_params = {
	FunctionName: 'testGulpAWSLambda',
	Role: '[YOUR LAMBDA EXEC ROLE HERE]'
};

var opts = {
	region: 'us-west-2'
};

gulp.task('default', function() {
	return gulp.src('index.js')
		.pipe(zip('archive.zip'))
		//.pipe(lambda(lambda_params, opts))
		.pipe(lambda('testGulpAWSLambda', opts))
		.pipe(gulp.dest('.'));
});
