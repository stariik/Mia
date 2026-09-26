/** Bounded account probe. Prints status/capabilities, never credentials or transcripts. */
import dotenv from 'dotenv';
import fs from 'node:fs';
import { v2, protos } from '@google-cloud/speech';
import { elevenlabs } from '../src/stt/providers';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

async function main() {
  if (process.env.ELEVENLABS_API_KEY) {
    const response = await fetch(
      'https://api.elevenlabs.io/v1/user/subscription',
      {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        signal: AbortSignal.timeout(8000),
      },
    );
    const body = await response.json();
    console.log(
      JSON.stringify({
        provider: 'elevenlabs',
        subscriptionHttpStatus: response.status,
        tier: response.ok ? body.tier : undefined,
        sttAllowanceVerified: false,
        actualBilledUsd: null,
      }),
    );
    if (process.argv.includes('--stream'))
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setInterval> | undefined;
        let count = 0;
        const deadline = setTimeout(() => {
          provider.cancel();
          clearInterval(timer);
          console.log('elevenlabs: probe deadline reached');
          resolve();
        }, 8000);
        const provider = elevenlabs((event) => {
          if (event.type === 'partial' || event.type === 'segment') {
            console.log(
              JSON.stringify({
                provider: 'elevenlabs',
                event: event.type,
                hasText: !!event.text.trim(),
              }),
            );
            return;
          }
          console.log(
            JSON.stringify({ provider: 'elevenlabs', event: event.type }),
          );
          if (event.type === 'ready')
            timer = setInterval(() => {
              provider.write(Buffer.alloc(3200));
              if (++count === 25) {
                clearInterval(timer);
                provider.finish();
              }
            }, 100);
          if (event.type === 'error' || event.type === 'done') {
            clearInterval(timer);
            clearTimeout(deadline);
            provider.cancel();
            resolve();
          }
        });
      });
  } else console.log('elevenlabs: credentials unavailable');
  const keyFilename =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    './google-service-account.json';
  if (!fs.existsSync(keyFilename)) {
    console.log('google: credentials unavailable');
    return;
  }
  const project =
    process.env.GOOGLE_CLOUD_PROJECT ??
    JSON.parse(fs.readFileSync(keyFilename, 'utf8')).project_id;
  // Existing HTTP recognizer region, unless an explicit candidate region is configured.
  const region = process.env.STT_GOOGLE_REGION ?? 'us-central1';
  const client = new v2.SpeechClient({
    keyFilename,
    apiEndpoint: `${region}-speech.googleapis.com`,
  });
  try {
    const response = await client.getLocation(
      { name: `projects/${project}/locations/${region}` },
      { timeout: 8000 },
    );
    const location = Array.isArray(response) ? response[0] : response;
    const metadata = location.metadata?.value
      ? protos.google.cloud.speech.v2.LocationsMetadata.decode(
          location.metadata.value as Uint8Array,
        )
      : undefined;
    const models = metadata?.languages?.models?.['ka-GE']?.modelFeatures;
    console.log(
      JSON.stringify({
        provider: 'google',
        region,
        georgianChirp3Listed: !!models?.chirp_3,
        creditsVerified: false,
        actualBilledUsd: null,
      }),
    );
    if (process.argv.includes('--stream') && models?.chirp_3) {
      await new Promise<void>((resolve) => {
        const stream = client._streamingRecognize();
        const deadline = setTimeout(() => {
          stream.destroy();
          console.log('google: probe deadline reached');
          resolve();
        }, 8000);
        stream.on('data', () => {});
        stream.on('error', (error: { code?: number }) => {
          clearTimeout(deadline);
          console.log(
            JSON.stringify({
              provider: 'google',
              streamAccepted: false,
              code: error.code,
            }),
          );
          resolve();
        });
        stream.on('end', () => {
          clearTimeout(deadline);
          console.log(
            JSON.stringify({ provider: 'google', streamAccepted: true }),
          );
          resolve();
        });
        stream.write({
          recognizer: `projects/${project}/locations/${region}/recognizers/_`,
          streamingConfig: {
            config: {
              model: 'chirp_3',
              languageCodes: ['ka-GE'],
              explicitDecodingConfig: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                audioChannelCount: 1,
              },
            },
            streamingFeatures: {
              interimResults: true,
              enableVoiceActivityEvents: true,
            },
          },
        });
        stream.write({ audio: Buffer.alloc(16000) });
        stream.end();
      });
    }
  } catch (error) {
    console.log(
      JSON.stringify({
        provider: 'google',
        metadataVerified: false,
        code: (error as { code?: number }).code,
      }),
    );
  } finally {
    await client.close();
  }
}
main().catch(() => {
  console.error('STT probe failed; no secrets were logged.');
  process.exitCode = 1;
});
