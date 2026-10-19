/* eslint-env jest */
const { act } = require('@testing-library/react-native');
const { notifyManager } = require('@tanstack/react-query');

// Run query notifications now, inside `act`, so tests do not leak timers or warn.
notifyManager.setScheduler((callback) => callback());
notifyManager.setNotifyFunction((callback) => {
  act(callback);
});

// Runs after Testing Library's own cleanup (registered by the require above) has unmounted the tree.
afterEach(() => {
  require('./src/test-query').clearTestQueryClients();
});
