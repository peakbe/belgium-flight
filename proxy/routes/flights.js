import express from 'express';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const flights = [
      {
        id: 1,
        from: "BRU",
        to: "LGG",
        departure: "2026-03-20T14:00:00Z",
        arrival: "2026-03-20T14:25:00Z",
        status: "scheduled"
      }
    ];

    res.json({ flights });
  } catch (err) {
    next(err);
  }
});

export default router;
``
