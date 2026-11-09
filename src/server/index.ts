import { app } from "./app";
import { config, aiEnabled } from "./config";

app.listen(config.port, () => {
  console.log(`LifeFlow API http://localhost:${config.port}  (AI: ${aiEnabled() ? "açık, " + config.anthropicModel : "KAPALI - ANTHROPIC_API_KEY yok"})`);
});
