/**
 * Local entry for the payments area process.
 */

import { serveHttp } from '../../../local/src/serve-http.js';
import { areaPort } from '../../lib/names.js';
import { handler } from './handler.js';

serveHttp(Number(process.env.PORT ?? areaPort('payments')), handler);
