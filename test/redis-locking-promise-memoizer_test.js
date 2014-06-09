'use strict';

var sinon = require('sinon');
var assert = require('assert');
var q = require('q');
var memoize = require('../lib/redis-locking-promise-memoizer')();

describe('memoize tests', function () {
    it('should call the function', function (done) {
        var EXTERNAL_RESOURCE_1 = 'external result 1';
        var spy = sinon.spy();
        var callback = function () {
            spy();
            return EXTERNAL_RESOURCE_1;
        };
        memoize(callback, 1000)().then(function (res) {
            assert(spy.calledOnce);
            assert(res === EXTERNAL_RESOURCE_1);
        }).nodeify(done);
    });

    it('should call the function only once', function (done) {
        var EXTERNAL_RESOURCE_2 = 'external result 2';
        var spy = sinon.spy();
        var callback = function () {
            spy();
            return EXTERNAL_RESOURCE_2;
        };
        var memoizedFunction = memoize(callback, 1000);
        q.all([
            memoizedFunction(),
            memoizedFunction()
        ]).spread(function (res1, res2) {
            assert(spy.calledOnce);
            assert(res1 === EXTERNAL_RESOURCE_2);
            assert(res2 === EXTERNAL_RESOURCE_2);
        }).nodeify(done);
    });

    it('should call the function once each time the ttl expires', function (done) {
        this.timeout(30000);
        var EXTERNAL_RESOURCE_3 = 'external result 3';
        var MEMOIZE_TIMEOUT = 100;
        var spy = sinon.spy();
        var last;
        var externalCallCount = 0;
        var callback = function () {
            ++externalCallCount;
            var now = new Date();
            if (last) {
                var delta = (now.getTime() - last.getTime());
                assert(delta > MEMOIZE_TIMEOUT);
            }
            last = now;
            spy();
            return EXTERNAL_RESOURCE_3;
        };

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
        deferredLoop(memoize(callback, MEMOIZE_TIMEOUT), 10000).then(function () {
            var now = new Date();
            var delta = now.getTime() - start.getTime();
            // the timing isn't perfect, so if X time has passed, support either the floor or ceil of the expected number
            assert(externalCallCount === Math.floor(delta / MEMOIZE_TIMEOUT) || externalCallCount === Math.ceil(delta / MEMOIZE_TIMEOUT));
        }).nodeify(done);
    });
});