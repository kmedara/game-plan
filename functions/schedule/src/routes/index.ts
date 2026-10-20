/**
 * Schedule route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleClaimCarpool, handleGetCarpool, handlePutCarpool } from './carpool.js';
import {
  handleCancelOccurrence,
  handleCreateEvent,
  handleDeleteEvent,
  handleGetEvent,
  handleSaveOccurrence,
  handleUpdateEvent,
} from './events.js';
import {
  handleAcceptFixture,
  handleDeclineFixture,
  handleListFixtures,
  handleProposeFixture,
  handleUnlinkFixture,
  handleUpdateFixture,
} from './fixtures.js';
import { handleGetLineup, handlePutLineup } from './lineup.js';
import { handleCalendarFeed, handleGetFeed, handleRotateFeed } from './feeds.js';
import { handleListSchedule } from './list.js';
import { handleClaimSignup, handleGetSignups, handlePutSignups } from './signups.js';
import { handleUpsertRsvp } from './rsvp.js';

export {
  handleAcceptFixture,
  handleClaimSignup,
  handleGetSignups,
  handlePutSignups,
  handleCalendarFeed,
  handleGetFeed,
  handleRotateFeed,
  handleCancelOccurrence,
  handleClaimCarpool,
  handleCreateEvent,
  handleDeclineFixture,
  handleDeleteEvent,
  handleGetCarpool,
  handleGetEvent,
  handleGetLineup,
  handleListFixtures,
  handleListSchedule,
  handleProposeFixture,
  handlePutCarpool,
  handlePutLineup,
  handleSaveOccurrence,
  handleUnlinkFixture,
  handleUpdateEvent,
  handleUpdateFixture,
  handleUpsertRsvp,
};

/** Every schedule HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleListSchedule,
  handleListFixtures,
  handleCreateEvent,
  handleProposeFixture,
  handleGetEvent,
  handleUpdateEvent,
  handleDeleteEvent,
  handleSaveOccurrence,
  handleCancelOccurrence,
  handleUpsertRsvp,
  handleGetLineup,
  handlePutLineup,
  handleGetCarpool,
  handlePutCarpool,
  handleClaimCarpool,
  handleUpdateFixture,
  handleUnlinkFixture,
  handleAcceptFixture,
  handleDeclineFixture,
  handleGetFeed,
  handleRotateFeed,
  handleCalendarFeed,
  handleGetSignups,
  handlePutSignups,
  handleClaimSignup,
];
