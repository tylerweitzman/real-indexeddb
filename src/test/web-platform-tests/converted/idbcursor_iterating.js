require("../wpt-env.js");

/* Delete created databases
 *
 * Go through each finished test, see if it has an associated database. Close
 * that and delete the database. */
add_completion_callback(function(tests)
{
    for (var i in tests)
    {
        if(tests[i].db)
        {
            tests[i].db.close();
            self.indexedDB.deleteDatabase(tests[i].db.name);
        }
    }
});

function fail(test, desc) {
    return test.step_func(function(e) {
        if (e && e.message && e.target.error)
            assert_unreached(desc + " (" + e.target.error.name + ": " + e.message + ")");
        else if (e && e.message)
            assert_unreached(desc + " (" + e.message + ")");
        else if (e && e.target.readyState === 'done' && e.target.error)
            assert_unreached(desc + " (" + e.target.error.name + ")");
        else
            assert_unreached(desc);
    });
}

function createdb(test, dbname, version)
{
    var rq_open = createdb_for_multiple_tests(dbname, version);
    return rq_open.setTest(test);
}

function createdb_for_multiple_tests(dbname, version) {
    var rq_open,
        fake_open = {},
        test = null,
        dbname = (dbname ? dbname : "testdb-" + new Date().getTime() + Math.random() );

    if (version)
        rq_open = self.indexedDB.open(dbname, version);
    else
        rq_open = self.indexedDB.open(dbname);

    function auto_fail(evt, current_test) {
        /* Fail handlers, if we haven't set on/whatever/, don't
         * expect to get event whatever. */
        rq_open.manually_handled = {};

        rq_open.addEventListener(evt, function(e) {
            if (current_test !== test) {
                return;
            }

            test.step(function() {
                if (!rq_open.manually_handled[evt]) {
                    assert_unreached("unexpected open." + evt + " event");
                }

                if (e.target.result + '' == '[object IDBDatabase]' &&
                    !this.db) {
                  this.db = e.target.result;

                  this.db.onerror = fail(test, 'unexpected db.error');
                  this.db.onabort = fail(test, 'unexpected db.abort');
                  this.db.onversionchange =
                      fail(test, 'unexpected db.versionchange');
                }
            });
        });
        rq_open.__defineSetter__("on" + evt, function(h) {
            rq_open.manually_handled[evt] = true;
            if (!h)
                rq_open.addEventListener(evt, function() {});
            else
                rq_open.addEventListener(evt, test.step_func(h));
        });
    }

    // add a .setTest method to the IDBOpenDBRequest object
    Object.defineProperty(rq_open, 'setTest', {
        enumerable: false,
        value: function(t) {
            test = t;

            auto_fail("upgradeneeded", test);
            auto_fail("success", test);
            auto_fail("blocked", test);
            auto_fail("error", test);

            return this;
        }
    });

    return rq_open;
}

function assert_key_equals(actual, expected, description) {
  assert_equals(indexedDB.cmp(actual, expected), 0, description);
}

function indexeddb_test(upgrade_func, open_func, description, options) {
  async_test(function(t) {
    options = Object.assign({upgrade_will_abort: false}, options);
    var dbname = location + '-' + t.name;
    var del = indexedDB.deleteDatabase(dbname);
    del.onerror = t.unreached_func('deleteDatabase should succeed');
    var open = indexedDB.open(dbname, 1);
    open.onupgradeneeded = t.step_func(function() {
      var db = open.result;
      t.add_cleanup(function() {
        // If open didn't succeed already, ignore the error.
        open.onerror = function(e) {
          e.preventDefault();
        };
        db.close();
        indexedDB.deleteDatabase(db.name);
      });
      var tx = open.transaction;
      upgrade_func(t, db, tx, open);
    });
    if (options.upgrade_will_abort) {
      open.onsuccess = t.unreached_func('open should not succeed');
    } else {
      open.onerror = t.unreached_func('open should succeed');
      open.onsuccess = t.step_func(function() {
        var db = open.result;
        if (open_func)
          open_func(t, db, open);
      });
    }
  }, description);
}

// Call with a Test and an array of expected results in order. Returns
// a function; call the function when a result arrives and when the
// expected number appear the order will be asserted and test
// completed.
function expect(t, expected) {
  var results = [];
  return result => {
    results.push(result);
    if (results.length === expected.length) {
      assert_array_equals(results, expected);
      t.done();
    }
  };
}

// Checks to see if the passed transaction is active (by making
// requests against the named store).
function is_transaction_active(tx, store_name) {
  try {
    const request = tx.objectStore(store_name).get(0);
    request.onerror = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    return true;
  } catch (ex) {
    assert_equals(ex.name, 'TransactionInactiveError',
                  'Active check should either not throw anything, or throw ' +
                  'TransactionInactiveError');
    return false;
  }
}

// Keeps the passed transaction alive indefinitely (by making requests
// against the named store). Returns a function that asserts that the
// transaction has not already completed and then ends the request loop so that
// the transaction may autocommit and complete.
function keep_alive(tx, store_name) {
  let completed = false;
  tx.addEventListener('complete', () => { completed = true; });

  let keepSpinning = true;

  function spin() {
    if (!keepSpinning)
      return;
    tx.objectStore(store_name).get(0).onsuccess = spin;
  }
  spin();

  return () => {
    assert_false(completed, 'Transaction completed while kept alive');
    keepSpinning = false;
  };
}



    var db,
      count = 0,
      t = async_test();

    var open_rq = createdb(t);
    open_rq.onupgradeneeded = function(e) {
        db = e.target.result;
        t.add_cleanup(function() { db.close(); indexedDB.deleteDatabase(db.name); });
        var objStore = db.createObjectStore("test", { keyPath: "key" });

        for (var i = 0; i < 500; i++)
            objStore.add({ key: i, val: "val_"+i });

        var rq = objStore.add({ key: 500, val: "val_500" });

        rq.onsuccess = t.step_func(function() {
            for (var i = 999; i > 500; i--)
                objStore.add({ key: i, val: "val_"+i });
        });

        objStore.createIndex('index', ['key', 'val']);
    };

    open_rq.onsuccess = function(e) {
        var cursor_rq = db.transaction("test", "readwrite")
                          .objectStore("test")
                          .openCursor();

        cursor_rq.onsuccess = t.step_func(function(e) {
            var cursor = e.target.result,
              store = e.target.source;
            if (!cursor) {
                assert_equals(count, 997, "cursor run count");

                var rq = e.target.source.count();
                rq.onsuccess = t.step_func(function(e) {
                    assert_equals(e.target.result, 995, "object count");
                    t.done();
                });
                return;
            }

            switch (cursor.key) {
                case 10:
                    assert_equals(count, cursor.key, "count");
                    store.delete(11);
                    break;

                case 12:
                case 499:
                case 500:
                case 501:
                    assert_equals(count, cursor.key - 1, "count");
                    break;

                // Delete the next key
                case 510:
                    store.delete(511);
                    break;

                // Delete randomly
                case 512:
                    store.delete(611);
                    store.delete(499);
                    store.delete(500);
                    break;

                // Delete and add a new key
                case 520:
                    store.delete(521);
                    store.add({ key: 521, val: "new"});
                    break;

                case 521:
                    assert_equals(cursor.value.val, "new");
                    break;

                // We should only be here once although we're basically making the index
                // "heavier" with its new key.
                case 530:
                    assert_equals(cursor.value.val, "val_530");
                    cursor.update({ key: 530, val: "val_531" })

                    store.get(530).onsuccess = t.step_func(function(e) {
                        assert_equals(e.target.result.val, "val_531");
                    });
                    break;

                // Shouldn't happen.
                case 11:
                case 511:
                case 611:
                    assert_unreached(cursor.key + " should be deleted and never run");
                    break;
            }

            cursor.continue();
            count++;
        });
    };
