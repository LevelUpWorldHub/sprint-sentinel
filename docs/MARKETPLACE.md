# Marketplace checklist

Codegeist awards a bonus for an app that is published on the Atlassian Marketplace or submitted for review. Sprint Sentinel is not listed yet. A person from Level Up Inc has to do that in the developer console. Keep the listing link or the review-ticket URL for the Devpost form.

Do this after `forge register` and a successful `forge deploy`.

1. Create or join an Atlassian Marketplace partner account for Level Up Inc.
2. In the developer console, open the app the CLI registered and complete the listing: name **Sprint Sentinel**, summary, and the description from `docs/SUBMISSION.md`.
3. Add a privacy policy URL. State that, when `XAI_API_KEY` is set, issue keys, summaries, statuses, assignee display names, and story-point numbers are sent to xAI at `api.x.ai` to explain a risk. With no key, that data stays in Atlassian. State that a connected Teamwork Graph digest is visible to the whole site because the connector declares `replicatesPermissions: false`.
4. Add a support contact and a documentation URL pointing at this README.
5. Decide licensing. The manifest has `licensing.enabled: false` so a hackathon site can install it without a license. Marketplace paid or Forge license enforcement means setting `enabled: true`, redeploying, and describing the trial in the listing. A free hackathon listing can stay unlicensed if the console allows it.
6. Provide an icon. `static/sentinel.svg` is the in-product mark. Export a Marketplace-sized PNG from it rather than using an Atlassian logo.
7. Submit the version for review. Paste either the public listing URL or the review ticket URL into Devpost.

The video should mention the listing only after the ticket exists.
