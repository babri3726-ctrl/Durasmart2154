import { NotConnected } from '../components/NotConnected';

export default function Settings() {
  return (
    <NotConnected
      title="Settings"
      absence="endpointNotCalled"
      hint="The business profile, default credit days and the approval flags are answered by GET /settings (any signed-in user) and changed by owner-only PATCH /settings, which needs the If-Match version that read returns. This screen is wired to neither, so it shows nothing rather than an edit that would change only this browser."
    />
  );
}
