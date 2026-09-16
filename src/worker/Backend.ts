import { FirebaseAppService } from './FirebaseAppService';
import { ConfigService } from './ConfigService';
import { EventService } from './EventService';
import { validateQualtricsUrl } from '../shared/StudyPolicy';
import { FINAL_SURVEY_URL } from '../shared/StudyConfig';

// Production transport only. The preview build replaces this module at build time.
export class Backend {
  readonly preview = false;
  private app = new FirebaseAppService();
  private config = new ConfigService(this.app);
  private events = new EventService(this.app, this.config);
  register(pid: string) { return this.app.login(pid); }
  track(event: string, properties: Record<string, any>) { return this.events.track(event, properties); }
  async surveyUrl(): Promise<string> {
    return validateQualtricsUrl(process.env.FINAL_SURVEY_URL || FINAL_SURVEY_URL);
  }
}
