/**
 * Local entry for the socket area process.
 */

import { serveSocket } from '../../../local/src/serve-socket.js';
import { areaPort } from '../../lib/names.js';
import { handler } from './handler.js';

serveSocket(Number(process.env.PORT ?? areaPort('socket')), handler);
