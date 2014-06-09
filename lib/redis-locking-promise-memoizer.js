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
var redis = require('redis');
var redisLock = require('redis-lock');
var q = require('q');

var hash = function (string) {
    return crypto.createHmac('sha1', 'memo').update(string).digest('hex');
};

module.exports = function () {
    var client = redis.createClient.apply(null, arguments);
    var lock = redisLock(client);

    var getRedisKeyValue = function (key) {
        var getRequest = q.defer();
        client.get(key, getRequest.makeNodeResolver());
        return getRequest.promise.then(function (value) {
            assert(typeof value === 'string');
            return JSON.parse(value);
        });
    };

    var setRedisKeyValue = function (key, value, ttl) {
        var setRequest = q.defer();
        client.psetex(key, ttl, JSON.stringify(value), setRequest.makeNodeResolver());
        return setRequest.promise;
    };

    return function memoize (fn, key, ttl) {
        // do this outside the returned function so we only generate the key
        // once per memoization
        var functionKey = hash(key);
        return function () {
            var context = this;
            var args = Array.prototype.slice.call(arguments);
            var argumentsKey = hash(args.map(JSON.stringify).join(","));

            var key = 'memos:' + functionKey + ':' + argumentsKey;
            return q.resolve().then(function () {
                return getRedisKeyValue(key);
            }).fail(function () {
                var lockedOperationRequest = q.defer();
                lock(key, function(done) {
                    var setRequest = q.resolve().then(function () {
                        return getRedisKeyValue(key);
                    }).fail(function () {
                        return q.resolve().then(function () {
                            return fn.apply(context, args);
                        }).then(function (value) {
                            return setRedisKeyValue(key, value, ttl).thenResolve(value);
                        });
                    });
                    setRequest.nodeify(done);
                    lockedOperationRequest.resolve(setRequest);
                });
                return lockedOperationRequest.promise;
            });
        };
    };
};
