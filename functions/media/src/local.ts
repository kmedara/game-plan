/**
 * Local entry for the media area process.
 */

import { serveHttp } from '../../../local/src/serve-http.js';
import { areaPort } from '../../lib/names.js';
import { handler } from './handler.js';

serveHttp(Number(process.env.PORT ?? areaPort('media')), handler);
