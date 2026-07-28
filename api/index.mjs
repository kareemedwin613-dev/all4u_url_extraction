import { createApiApplication } from "../apps/api/dist/main.js";
import { prepareRoutedRequest } from "./request-url.mjs";

let handlerPromise;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = createApiApplication({ serverless: true }).then(async (app) => {
      await app.init();
      return app.getHttpAdapter().getInstance();
    }).catch((error) => {
      handlerPromise = undefined;
      throw error;
    });
  }
  return handlerPromise;
}

export default async function handler(request, response) {
  prepareRoutedRequest(request);
  return (await getHandler())(request, response);
}
