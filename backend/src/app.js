const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorMiddleware, securityHeaders, HttpError } = require('./lib/http');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors({ origin: config.corsOrigins, credentials: false }));
app.use(express.json({ limit: '100kb' }));

app.use('/auth', require('./routes/auth'));
app.use('/me', require('./routes/me'));
app.use('/borrower', require('./routes/borrower'));
app.use('/lender', require('./routes/lender'));
app.use('/insurer', require('./routes/insurer'));
app.use('/', require('./routes/shared'));

app.use((_req, _res, next) => next(new HttpError(404, 'Route not found', 'NOT_FOUND')));
app.use(errorMiddleware);

module.exports = app;
