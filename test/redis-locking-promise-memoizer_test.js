'use strict';

var sinon = require('sinon');
var assert = require('assert');
var q = require('q');
var redis = require('redis');
// redis.debug_mode = true;
var client = redis.createClient();
var memoize = require('../lib/redis-locking-promise-memoizer')(client);

var EXTERNAL_RESOURCE = 'external result';
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
            assert(callback.returnValues[0] === EXTERNAL_RESOURCE);
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
            assert(callback.returnValues[0] === EXTERNAL_RESOURCE);
            assert(res1 === EXTERNAL_RESOURCE);
            assert(res2 === EXTERNAL_RESOURCE);
        }).nodeify(done);
    });

    it('should call the function once even if it resolves with undefined', function (done) {
        var callback = sinon.spy(function () {
            return q.resolve();
        });
        var memoizedFunction = memoize(callback, KEY, 1000);
        q.all([
            memoizedFunction(),
            memoizedFunction()
        ]).spread(function (res1, res2) {
            assert(typeof res1 === 'undefined');
            assert(typeof res2 === 'undefined');
            assert(callback.calledOnce);
        }).nodeify(done);
    });

    it('should call the function repeatedly if it throws an exception', function (done) {
        var count = 0;
        var callback = sinon.spy(function () {
            throw count++;
        });
        var memoizedFunction = memoize(callback, KEY, 1000);
        q.allSettled([
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction(),
            memoizedFunction()
        ]).then(function (defers) {
            for (var i = 0; i < defers.length; ++i) {
                var defer = defers[i];
                assert(defer.state === 'rejected');
                assert(defer.reason === i);
            }
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
        }).then(function () {
            var defer = q.defer();
            client.dbsize(defer.makeNodeResolver());
            return defer.promise;
        }).then(function (count) {
            assert(count === 3);
        }).nodeify(done);
    });

    it('an unresolved function cannot hold the lock indefinitely', function (done) {
        this.timeout(6000);
        memoize(function () {
            return q.defer().promise;
        }, KEY, 1000)();

        var callback = sinon.spy(function () {
            return EXTERNAL_RESOURCE;
        });

        memoize(callback, KEY, 1000)().then(function (res) {
            assert(callback.calledOnce);
            assert(res === EXTERNAL_RESOURCE);
            assert(callback.returnValues[0] === EXTERNAL_RESOURCE);
        }).then(function () {
            var defer = q.defer();
            client.dbsize(defer.makeNodeResolver());
            return defer.promise;
        }).then(function (count) {
            assert(count === 1);
        }).nodeify(done);
    });

    it('should store results in different redis keys for differing key/arg combinations', function (done) {
        var callback1 = memoize(function () {}, 'key1', 1000);
        var callback2 = memoize(function () {}, 'key2', 1000);
        q.all([
            callback1(1),
            callback1(2),
            callback1(3),
            callback2(1),
            callback2(2),
            callback2(3)
        ]).then(function () {
            var defer = q.defer();
            client.dbsize(defer.makeNodeResolver());
            return defer.promise;
        }).then(function (count) {
            assert(count === 6);
        }).nodeify(done);
    });

    it('should treat undefined and null return values as different successful results', function (done) {
        var callback1 = memoize(function () {}, 'key1', 1000);
        var callback2 = memoize(function () { return null; }, 'key2', 1000);
        q.all([
            callback1(),
            callback2()
        ]).spread(function (res1, res2) {
            assert(res1 !== res2);
        }).nodeify(done);
    });
});