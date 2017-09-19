/*
 * redis-locking-promise-memoizer
 * https://github.com/pwmckenna/node-redis-locking-promise-memoizer
 *
 * Copyright (c) 2014 Patrick Williams
 * Licensed under the MIT license.
 */

'use strict';

var assert = require('assert');
var crypto = require('crypto');
var redisLock = require('redis-lock-q');
var q = require('q');

var MEMOS_KEY_PREFIX = 'memos-key:';
var MEMOS_VALUE_PREFIX = 'memos-value:';

var hash = function (string) {
    return crypto.createHmac('sha1', 'memo').update(string).digest('hex');
};

module.exports = function (client) {
    var lock = redisLock(client);

    var getRedisKeyValue = function (key) {
        var getRequest = q.defer();
        client.get(key, getRequest.makeNodeResolver());
        return getRequest.promise.then(function (value) {
            assert(typeof value === 'string', 'invalid value type - ' + typeof value);
            assert(value.length >= MEMOS_VALUE_PREFIX.length, 'invalid value - ' + value);
            var ret = value.substr(MEMOS_VALUE_PREFIX.length);
            // undefined will be serialized only because it is concatenated with the
            // value prefix...but it will not parse correctly
            if (ret === 'undefined') {
                return;
            } else {
                return JSON.parse(ret);
            }
        });
    };

    var setRedisKeyValue = function (key, value, ttl) {
        var setRequest = q.defer();
        client.psetex(key, ttl, MEMOS_VALUE_PREFIX + JSON.stringify(value), setRequest.makeNodeResolver());
        return setRequest.promise;
    };

    var runWithLock = function (key, context, fn, args, ttl, mustReset) {
        return lock(key, function() {
            if (mustReset) return run();

            return q.resolve().then(function () {
                return getRedisKeyValue(key);
            }).fail(run);
        });

        var run = function () {
            return q.resolve().then(function () {
                return fn.apply(context, args);
            }).then(function (value) {
                return setRedisKeyValue(key, value, ttl).thenResolve(value);
            });
        }
    };

    return function memoize (fn, key, ttl, reset) {
        var hasReset = false
        // do this outside the returned function so we only generate the key
        // once per memoization
        var functionKey = hash(key);
        return function () {
            var context = this;
            var args = Array.prototype.slice.call(arguments);
            var argumentsKey = hash(args.map(JSON.stringify).join(","));

            var key = MEMOS_KEY_PREFIX + functionKey + ':' + argumentsKey;

            // if we're resetting this function, then we don't need to lookup
            // redis for it
            var mustReset = reset && !hasReset

            return runWithLock(key, context, fn, ttl, mustReset).then(function(results) {
                hasReset = true
                return results
            });
        };
    };
};
