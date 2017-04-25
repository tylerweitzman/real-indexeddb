require("../../build/global");
const Event = require("../../build/lib/FakeEvent").default;
const {
    add_completion_callback,
    assert_array_equals,
    assert_equals,
    assert_false,
    assert_key_equals,
    assert_not_equals,
    assert_throws,
    assert_true,
    async_test,
    createdb,
    createdb_for_multiple_tests,
    fail,
    format_value,
    indexeddb_test,
    promise_test,
    setup,
    step_timeout,
    test,
} = require("../support-node");

const document = {};
const window = global;



function load_iframe(src, sandbox) {
  return new Promise(resolve => {
    const iframe = document.createElement('iframe');
    iframe.onload = () => { resolve(iframe); };
    if (sandbox)
      iframe.sandbox = sandbox;
    iframe.srcdoc = src;
    iframe.style.display = 'none';
    document.documentElement.appendChild(iframe);
  });
}

function wait_for_message(iframe) {
  return new Promise(resolve => {
    self.addEventListener('message', function listener(e) {
      if (e.source === iframe.contentWindow) {
        resolve(e.data);
        self.removeEventListener('message', listener);
      }
    });
  });
}

const script =
  '<script>' +
  '  window.onmessage = () => {' +
  '    try {' +
  '      const r = indexedDB.deleteDatabase("opaque-origin-test");' +
  '      window.parent.postMessage({result: "no exception"}, "*");' +
  '    } catch (ex) {' +
  '      window.parent.postMessage({result: ex.name}, "*");' +
  '    };' +
  '  };' +
  '<\/script>';

promise_test(t => {
  return load_iframe(script)
    .then(iframe => {
      iframe.contentWindow.postMessage({}, '*');
      return wait_for_message(iframe);
    })
    .then(message => {
      assert_equals(message.result, 'no exception',
                    'IDBFactory.deleteDatabase() should not throw');
    });
}, 'IDBFactory.deleteDatabase() in non-sandboxed iframe should not throw');

promise_test(t => {
  return load_iframe(script, 'allow-scripts')
    .then(iframe => {
      iframe.contentWindow.postMessage({}, '*');
      return wait_for_message(iframe);
    })
    .then(message => {
      assert_equals(message.result, 'SecurityError',
                    'Exception should be SecurityError');
    });
}, 'IDBFactory.deleteDatabase() in sandboxed iframe should throw SecurityError');