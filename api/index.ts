import { createApp } from '../src/app.js';
import { kafka } from '../src/kafka.js';
import { lazyProducer } from '../src/lazy-producer.js';

// Reuse the producer across warm invocations; connect inside the publishing request.
// Vercel owns the HTTP listener and the function lifecycle.
export default createApp(lazyProducer(kafka.producer({ allowAutoTopicCreation: false })));
