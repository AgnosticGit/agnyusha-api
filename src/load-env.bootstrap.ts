import {
  assertProductionCdekContour,
  syncDeliveryEnvWithNodeEnv,
} from './load-env';

syncDeliveryEnvWithNodeEnv();
assertProductionCdekContour();
