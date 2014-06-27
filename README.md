# redis-locking-promise-memoize [![Build Status](https://travis-ci.org/pwmckenna/node-redis-locking-promise-memoizer.svg?branch=master)](https://travis-ci.org/pwmckenna/node-redis-locking-promise-memoizer)

===

Heavily inspired by [redis-memoizer](https://github.com/errorception/redis-memoizer), but with some key differences.

* Promise based. Expects the function to return a promise, and the memoized function returns a promise. Uses [Q](https://github.com/kriskowal/q) internally.
* Rather than trying to generate redis keys based on the input function (which can collide for identical functions in different contexts), the caller must explicitly provide a base value for keys to be generated based on.
* Locking. This library doesn't try to mitigate cache stampedes (which can be addressed by combining this library with an in-memory memoizer), instead focusing on reducing the calls to the original function across all process instances by introducing locking at the redis level.

A promise based asynchronous function memoizer for node.js, using redis as the memo store. Memos expire after a specified timeout. Great as a drop-in performance optimization / caching layer for heavy asynchronous functions.

Wikipedia [explains it best](http://en.wikipedia.org/wiki/Memoization):
> ...memoization is an optimization technique used primarily to speed up computer programs by having function calls avoid repeating the calculation of results for previously processed inputs.

```javascript
var memoize = require("redis-locking-promise-memoizer")();

function someExpensiveOperation(arg1, arg2) {
	// later...
	return Q.promise();
}

// only do that expensive thing once per minute
var memoized = memoize(someExpensiveOperation, 'some key', 60 * 1000);
```

Now, calls to `memoized` will have the same effect as calling `someExpensiveOperation`, except it will be much faster. The results of the first call are stored in redis and then looked up for subsequent calls.

Redis effectively serves as a shared network-available cache for function calls. Thus, the memoization cache is available across processes, so that if the same function call is made from different processes they will reuse the cache.

## Uses

Lets say you are making a DB call that's rather expensive. Let's say you've wrapped the call into a `getUserProfile` function that looks as follows:

```javascript
function getUserProfile(userId) {
	// Go over to the DB, perform expensive call, get user's profile
	return Q.resolve(userProfile);
}
```

Let's say this call takes 500ms, which is unacceptably high, and you want to make it faster, and don't care about the fact that the value of `userProfile` might be slightly outdated (until the cache timeout is hit in redis). You could simply do the following:

```javascript
// only check for user changes once per hour
var getMemoizedUserProfile = memoize(getUserProfile, 'user profile', 60 * 60 * 1000);

getMemoizedUserProfile("user1").then(function(userProfile) {
	// First call. This will take some time.

	getMemoizedUserProfile("user1").then(function(userProfile) {
		// Second call. This will be blazingly fast.
	});
});

```

This can similarly be used for any network or disk bound async calls where you are tolerant of slightly outdated values.

## Usage

### Initialization
```javascript
var memoize = require("redis-locking-promise-memoizer")(redisPort, redisHost, redisOptions);
```

Initializes the module with redis' connection parameters. The params are passed along as-is to the [node-redis](https://github.com/mranney/node_redis#rediscreateclientport-host-options) module for connecting to redis.

### memoize(fn, key, timeout)

Memoizes a promise returning function and returns it.

* `fn` must be a function that returns a promise (if it returns a value synchronously, the memoized version will return a promise that resolves to that value).

* `key` is the unique id for this memoized function. You can memoize the same function into two memoized functions by changing this key, or make two difference functions share a cache by setting this to the same value.

* `timeout` is the amount of time in milliseconds for which the result of the function call should be cached in redis. Once the timeout is hit, the value is deleted from redis automatically. This is done using the redis [`psetex` command](http://redis.io/commands/psetex). The timeout is only set the first time, so the value expires after the timeout time has expired since the first call. The timeout is not reset with every call to the memoized function. Once the value has expired in redis, this module will treat the function call as though it's called the first time again. `timeout` can alternatively be a function, if you want to dynamically determine the cache time based on the data returned. The returned data will be passed into the timeout function.

	```javascript
	var httpCallMemoized = memoize(makeHttpCall, function(res) {
		// return a number based on say response's expires header
	});

	httpCallMemoized(function(res) { ... });
	```

## Cache Stampedes

Rather than protect against redis [cache stampedes](http://en.wikipedia.org/wiki/Cache_stampede), as redis-memoizer does, this module uses locking to ensure that only one instance of the memoized function is called across all instances of your program. An in-memory memoizer is recommended to reduce the load on redis.

In-Memory/Redis memoizing combo example:
```js
var localMemoize = require('memoizee');
var redisMemoize = require('redis-locking-promise-memoizer');

var memoize = function (fn, key, ttl) {
    return localMemoize(redisMemoize(fn, key, ttl), { maxAge: ttl });
};
```

## Installation

Use npm to install redis-locking-promise=memoizer:
```
npm install redis-locking-promise-memoizer
```

To run the tests, install the dev-dependencies by `cd`'ing into `node_modules/redis-locking-promise-memoizer` and running `npm install` once, and then `grunt test`.

## License

(The MIT License)

Copyright (c) 2014 Patrick Williams <pwmckenna@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
