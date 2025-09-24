import express from 'express';
import mongoose from 'mongoose';
import pino from 'pino';
import pinoHttp from 'pino-http';

const PORT = process.env.PORT || 3007;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/keephy_staff';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

mongoose.set('strictQuery', true);
mongoose
  .connect(MONGO_URL, { autoIndex: true })
  .then(() => logger.info({ msg: 'Connected to MongoDB', url: MONGO_URL }))
  .catch((err) => {
    logger.error({ err }, 'MongoDB connection error');
    process.exit(1);
  });

const staffSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    franchiseId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, index: true },
    role: { type: String, enum: ['manager', 'staff'], default: 'staff' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

staffSchema.index({ franchiseId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });

const scheduleSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', index: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    notes: { type: String },
  },
  { timestamps: true }
);

const Staff = mongoose.model('Staff', staffSchema);
const Schedule = mongoose.model('Schedule', scheduleSchema);

const app = express();
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'staff-service' }));
app.get('/ready', (_req, res) => {
  const state = mongoose.connection.readyState;
  res.status(state === 1 ? 200 : 503).json({ ready: state === 1 });
});

// Staff CRUD
app.post('/staff', async (req, res) => {
  try {
    const doc = await Staff.create(req.body);
    res.status(201).json(doc);
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: 'Duplicate staff for franchise/email' });
    req.log.error({ err }, 'staff create failed');
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/staff', async (req, res) => {
  try {
    const { businessId, franchiseId, page = 1, limit = 20 } = req.query;
    const q = {};
    if (businessId) q.businessId = businessId;
    if (franchiseId) q.franchiseId = franchiseId;
    const items = await Staff.find(q)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Math.min(Number(limit), 100))
      .lean();
    const total = await Staff.countDocuments(q);
    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    req.log.error({ err }, 'staff list failed');
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.patch('/staff/:id', async (req, res) => {
  try {
    const doc = await Staff.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    req.log.error({ err }, 'staff update failed');
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.delete('/staff/:id', async (req, res) => {
  try {
    const doc = await Staff.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, 'staff delete failed');
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Schedules
app.post('/staff/:id/schedule', async (req, res) => {
  try {
    const exists = await Staff.findById(req.params.id).lean();
    if (!exists) return res.status(404).json({ message: 'Staff not found' });
    const sch = await Schedule.create({ staffId: req.params.id, ...req.body });
    res.status(201).json(sch);
  } catch (err) {
    req.log.error({ err }, 'schedule create failed');
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/staff/:id/schedule', async (req, res) => {
  try {
    const items = await Schedule.find({ staffId: req.params.id }).sort({ start: 1 }).lean();
    res.json(items);
  } catch (err) {
    req.log.error({ err }, 'schedule list failed');
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.listen(PORT, () => logger.info(`staff-service listening on ${PORT}`));


