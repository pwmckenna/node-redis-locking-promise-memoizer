'use strict';

var sinon = require('sinon');
var assert = require('assert');
var q = require('q');
var redis = require('redis');
// redis.debug_mode = true;
var client = redis.createClient();
var memoize = require('../lib/redis-locking-promise-memoizer')(client);

var EXTERNAL_RESOURCE = 'external result';
var ERROR_MESSAGE = 'error message';
var KEY = 'key';

describe('memoize tests', function () {
    this.timeout(5000);
    beforeEach(function () {
        client.flushdb();
    });

    it('should call the function', function (done) {
        var callback = sinon.spy(function () {
            return EXTERNAL_RESOURCE;
        });
        memoize(callback, KEY, 1000)().then(function (res) {
            assert(callback.called);
            assert(res === EXTERNAL_RESOURCE);
        }).nodeify(done);
    });

    it('should call the function only once', function (done) {
        var callback = sinon.spy(function () {
            return EXTERNAL_RESOURCE;
        });
        var memoizedFunction = memoize(callback, KEY, 1000);
        q.all([
            memoizedFunction(),
            memoizedFunction()
        ]).spread(function (res1, res2) {
            assert(callback.calledOnce);
            assert(res1 === EXTERNAL_RESOURCE);
            assert(res2 === EXTERNAL_RESOURCE);
        }).nodeify(done);
    });

    it('should call the function once even if it resolves with undefined', function (done) {
        var callback = sinon.spy(function () {
            return q.resolve(null);
        });
        var memoizedFunction = memoize(callback, KEY, 1000);
        q.all([
            memoizedFunction(),
            memoizedFunction()
        ]).spread(function () {
            assert(callback.calledOnce);
        }).nodeify(done);
    });

    it('should call the function repeatedly if it throws an exception', function (done) {
        var callback = sinon.spy(function () {
            throw new Error(ERROR_MESSAGE);
        });
        var memoizedFunction = memoize(callback, KEY, 1000);
        q.allSettled([
            memoizedFunction(),
            memoizedFunction()
        ]).spread(function (defer1, defer2) {
            assert(defer1.state === 'rejected', 'defer1.state');
            assert(defer2.state === 'rejected', 'defer2.state');
            assert(defer1.reason.msg === defer2.reason.msg);
        }).nodeify(done);
    });


    it('should call the function once each time the ttl expires', function (done) {
        this.timeout(30000);
        var MEMOIZE_TIMEOUT = 100;
        var last;
        var externalCallCount = 0;
        var callback = sinon.spy(function () {
            ++externalCallCount;
            var now = new Date();
            if (last) {
                var delta = (now.getTime() - last.getTime());
                assert(delta > MEMOIZE_TIMEOUT);
            }
            last = now;
            return EXTERNAL_RESOURCE;
        });

        var deferredLoop = function (func, count) {
            if (count > 0) {
                return func().then(function () {
                    return deferredLoop(func, count - 1);
                });
            } else {
                return q.resolve();
            }
        };

        var start = new Date();
        deferredLoop(memoize(callback, KEY, MEMOIZE_TIMEOUT), 10000).then(function () {
            var now = new Date();
            var delta = now.getTime() - start.getTime();
            // the timing isn't perfect, so if X time has passed, support either the floor or ceil of the expected number
            assert(externalCallCount === Math.floor(delta / MEMOIZE_TIMEOUT) || externalCallCount === Math.ceil(delta / MEMOIZE_TIMEOUT));
        }).nodeify(done);
    });

    it('should cache multiple memoized versions of a function seperately', function (done) {
        var callback = sinon.spy(function () {
            return EXTERNAL_RESOURCE;
        });

        q.all([
            memoize(callback, 'key1', 1000)(),
            memoize(callback, 'key2', 1000)(),
            memoize(callback, 'key3', 1000)()
        ]).then(function () {
            assert(callback.calledThrice);
        }).nodeify(done);
    });
});