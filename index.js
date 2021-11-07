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
  Runtime: 'nodejs12.x'
};

function makeErr(message) {
  return new gutil.PluginError('gulp-awslambda', message);
}

/**
 *
 * @param {Lambda} lambda
 * @param {string} name
 * @param {{contents: Buffer|Uint8Array|Blob|string }} upload
 * @param {{Runtime: string}} params
 * @param {{}} opts
 * @returns {Promise<Lambda.FunctionConfiguration>}
 */
function updateFunctionCode(lambda, name, upload, params, opts) {
  delete params.Runtime;
  var code = { ZipFile: upload.contents };
  return lambda
    .updateFunctionCode(
      extend(
        {
          FunctionName: name
        },
        code,
        {
          Publish: opts.publish || false
        }
      )
    )
    .promise();
}

/**
 *
 * @param {Lambda} lambda
 * @param {{contents: Buffer | Blob| string}} upload
 * @param {{Code: *}} params
 * @param {{publish: [boolean]}} opts
 * @returns {Promise<Lambda.FunctionConfiguration>}
 */
function createFunction(lambda, upload, params, opts) {
  params.Code = params.Code || { ZipFile: upload.contents };
  return lambda
    .createFunction(
      extend(
        DEFAULT_PARAMS,
        {
          Publish: opts.publish || false
        },
        params
      )
    )
    .promise();
}

/**
 *
 * @param {string} operation
 * @param {Lambda} lambda
 * @param {string} functionName
 * @param {number} functionVersion
 * @param {string} alias
 * @param {string} aliasDescription
 * @returns {Promise}
 */
async function upsertAlias(
  operation,
  lambda,
  functionName,
  functionVersion,
  alias,
  aliasDescription
) {
  var params = {
    FunctionName: functionName,
    FunctionVersion: functionVersion,
    Name: alias,
    Description: aliasDescription
  };
  gutil.log(`attempting to ${operation} alias ${alias}`);
  const aliasFunc =
    operation === 'create'
      ? lambda.createAlias.bind(lambda)
      : lambda.updateAlias.bind(lambda);
  try {
    await aliasFunc(params).promise();
    gutil.log(
      `${operation}d alias ${gutil.colors.magenta(
        alias
      )} to point to version ${gutil.colors.magenta(functionVersion)}`
    );
  } catch (err) {
    gutil.log(`Could not ${operation} alias ${alias}: ${err}`);
  }
}

module.exports = function (params, opts) {
  opts = extend(DEFAULT_OPTS, opts);

  AWS.config.update({ region: opts.region });
  var lambda = new AWS.Lambda();
  var toUpload;
  var functionName = typeof params === 'string' ? params : params.FunctionName;

  async function updateOrCreateAlias(functionConfiguration) {
    let operation;
    if (!(opts.publish && opts.alias))
      return Promise.resolve('not updating alias');

    gutil.log(`Getting alias: ${opts.alias.name}`);
    try {
      await lambda
        .getAlias({
          FunctionName: functionName,
          Name: opts.alias.name
        })
        .promise();
      operation = 'update';
    } catch (error) {
      operation = 'create';
    }
    try {
      await upsertAlias(
        operation,
        lambda,
        functionName,
        (opts.alias.version || functionConfiguration.Version).toString(),
        opts.alias.name,
        opts.alias.description
      );
    } catch (error) {
      gutil.log(`Failed to ${operation} alias: ${error}`);
      throw error;
    }
  }
  function printVersion(functionConfiguration) {
    if (opts.publish) {
      gutil.log(
        'Publishing Function Version: ' +
          gutil.colors.magenta(functionConfiguration.Version)
      );
    }
  }
  function transform(file, enc, cb) {
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
  }

  async function flush(cb) {
    if (!toUpload && (typeof params === 'string' || !params.Code)) {
      return cb(makeErr('No code provided'));
    }
    if (toUpload && toUpload.path.slice(-4) !== '.zip') {
      return cb(makeErr('Provided file is not a ZIP'));
    }
    if (opts.alias) {
      if (!opts.alias.name) {
        return cb(
          makeErr(`Alias requires a ${gutil.colors.red('name')} parameter`)
        );
      } else if (!(typeof opts.alias.name === 'string')) {
        return cb(
          makeErr(`Alias ${gutil.colors.red('name')} must be a string`)
        );
      }
    }

    gutil.log(`Uploading Lambda function "${functionName}"...`);

    if (opts.profile !== null) {
      AWS.config.credentials = new AWS.SharedIniFileCredentials({
        profile: opts.profile
      });
    }

    var stream = this;

    function done(err) {
      if (err) {
        return cb(makeErr(err.message));
      }
      gutil.log(`Lambda function "${functionName}" successfully uploaded`);
      stream.push(toUpload);
      cb();
    }

    let functionConfiguration;
    if (typeof params === 'string') {
      // Just updating code
      try {
        gutil.log(`updating function code for "${functionName}"`);
        functionConfiguration = await updateFunctionCode(
          lambda,
          params,
          toUpload,
          params,
          opts
        );
        gutil.log(
          `function configuration is ${JSON.stringify(
            functionConfiguration
          )}. waiting for active state...`
        );
        await lambda
          .waitFor('functionActive', { FunctionName: functionName })
          .promise();
        printVersion(functionConfiguration);
        gutil.log(
          `updating alias "${opts.alias.name}" for function "${functionName}"`
        );
        await updateOrCreateAlias(functionConfiguration);
        done();
      } catch (error) {
        done(error);
      }
    } else {
      try {
        gutil.log(`getting function configuration for "${functionName}"`);
        const existingParams = await lambda
          .getFunctionConfiguration({
            FunctionName: functionName
          })
          .promise();
        try {
          // Updating code + config
          gutil.log(`updating function code for "${functionName}"`);
          functionConfiguration = await updateFunctionCode(
            lambda,
            functionName,
            toUpload,
            params,
            opts
          );
          gutil.log(
            `function configuration is ${JSON.stringify(
              functionConfiguration
            )}. waiting for active state...`
          );
          await lambda
            .waitFor('functionActive', { FunctionName: functionName })
            .promise();
          printVersion(functionConfiguration);
          gutil.log(
            `updating alias "${opts.alias.name}" for function "${functionName}"`
          );
          await updateOrCreateAlias(functionConfiguration);
          gutil.log(`waiting for update to complete...`);
          await lambda
            .waitFor('functionUpdated', { FunctionName: functionName })
            .promise();
          const {
            Description,
            FunctionName,
            Handler,
            MemorySize,
            Role,
            Runtime,
            Timeout
          } = existingParams;
          const newParams = {
            Description,
            FunctionName,
            Handler,
            MemorySize,
            Role,
            Runtime,
            Timeout,
            ...params
          };
          delete newParams.Code;
          gutil.log('updating function configuration...');
          await lambda.updateFunctionConfiguration(newParams).promise();
          done();
        } catch (error) {
          done(error);
        }
      } catch (error) {
        gutil.log(
          `failed to get configuration for "${functionName}". ${error}`
        );
        // Creating a function
        try {
          gutil.log(`creating function "${functionName}"`);
          functionConfiguration = await createFunction(
            lambda,
            toUpload,
            params,
            opts
          );
          gutil.log(
            `function configuration is ${JSON.stringify(
              functionConfiguration
            )}. waiting for active state...`
          );
          await lambda
            .waitFor('functionActive', { FunctionName: functionName })
            .promise();
          printVersion(functionConfiguration);
          await updateOrCreateAlias(functionConfiguration);
          done();
        } catch (error) {
          done(error);
        }
      }
    }
  }

  return through.obj(transform, flush);
};
