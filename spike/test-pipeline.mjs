/**
 * Georgian Voice AI — Pipeline Spike Test
 *
 * Tests the full chain: Whisper (STT) → GPT-4o (LLM) → TTS (voice output)
 *
 * Usage:
 *   node test-pipeline.mjs              # Uses generated test audio
 *   node test-pipeline.mjs my-audio.wav # Uses your own Georgian audio file
 */

import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const openai = new OpenAI();

// ── Step 0: Generate a Georgian test audio sample using TTS ──────────────
// (We use TTS to create a Georgian audio clip, then feed it back through the pipeline.
//  This lets us test without needing a real microphone recording.)

async function generateTestAudio() {
  console.log('\n📎 Step 0: Generating Georgian test audio via TTS...');
  console.log('   Text: "გამარჯობა, როგორ ხარ? რა ამინდია დღეს?"');
  console.log('   (Translation: "Hello, how are you? What is the weather today?")\n');

  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',
    input: 'გამარჯობა, როგორ ხარ? რა ამინდია დღეს?',
  });

  const outputPath = path.join('samples', 'test-georgian.mp3');
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  console.log(`   ✅ Saved test audio to ${outputPath} (${buffer.length} bytes)`);
  return outputPath;
}

// ── Step 1: Speech-to-Text (Whisper) ─────────────────────────────────────

async function transcribe(audioPath) {
  console.log('\n🎤 Step 1: Whisper Speech-to-Text...');
  console.log(`   Input: ${audioPath}`);

  // Note: Whisper doesn't support 'ka' as forced language.
  // We let it auto-detect — it can still recognize Georgian speech.
  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(audioPath),
    response_format: 'verbose_json',
  });

  console.log(`   ✅ Transcription: "${transcription.text}"`);
  console.log(`   🌐 Detected language: ${transcription.language}`);
  return transcription.text;
}

// ── Step 2: LLM Response (GPT-4o) ───────────────────────────────────────

async function chat(userMessage) {
  console.log('\n🧠 Step 2: GPT-4o LLM Response...');
  console.log(`   Input: "${userMessage}"`);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `შენ ხარ ქართულენოვანი ხმოვანი ასისტენტი.
შენ ყოველთვის პასუხობ ქართულად.
შენი პასუხები უნდა იყოს მოკლე და ბუნებრივი, რადგან ხმით წარმოითქმება.
არ გამოიყენო ემოჯი ან სპეციალური სიმბოლოები.
მაქსიმუმ 2-3 წინადადება.`
        // Translation: "You are a Georgian-speaking voice assistant.
        // You always respond in Georgian.
        // Your responses should be short and natural, as they will be spoken aloud.
        // Don't use emojis or special characters.
        // Maximum 2-3 sentences."
      },
      {
        role: 'user',
        content: userMessage,
      },
    ],
    temperature: 0.7,
  });

  const reply = completion.choices[0].message.content;
  const usage = completion.usage;

  console.log(`   ✅ Response: "${reply}"`);
  console.log(`   📊 Tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out`);
  console.log(`   💰 Model: gpt-4o-mini`);
  return reply;
}

// ── Step 3: Text-to-Speech (TTS) ────────────────────────────────────────

async function synthesize(text) {
  console.log('\n🔊 Step 3: OpenAI TTS...');
  console.log(`   Input: "${text}"`);

  const voices = ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer'];
  const outputDir = 'output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  // Test with 2 voices so we can compare
  const testVoices = ['nova', 'onyx'];

  for (const voice of testVoices) {
    const response = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: voice,
      input: text,
    });

    const outputPath = path.join(outputDir, `response-${voice}.mp3`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`   ✅ Voice "${voice}" saved to ${outputPath} (${buffer.length} bytes)`);
  }

  console.log(`\n   Available voices to test later: ${voices.join(', ')}`);
  return testVoices;
}

// ── Run the full pipeline ───────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Georgian Voice AI — Pipeline Spike Test');
  console.log('═══════════════════════════════════════════════════════');

  try {
    // Determine audio source
    let audioPath = process.argv[2];

    if (!audioPath) {
      audioPath = await generateTestAudio();
    } else {
      console.log(`\nUsing provided audio file: ${audioPath}`);
    }

    // Run the 3-step pipeline
    const transcription = await transcribe(audioPath);
    const response = await chat(transcription);
    const voices = await synthesize(response);

    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  RESULTS SUMMARY');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  🎤 Whisper heard:  "${transcription}"`);
    console.log(`  🧠 GPT replied:    "${response}"`);
    console.log(`  🔊 TTS voices:     ${voices.join(', ')}`);
    console.log('');
    console.log('  📁 Listen to outputs:');
    console.log('     spike/samples/test-georgian.mp3  (input audio)');
    voices.forEach(v => {
      console.log(`     spike/output/response-${v}.mp3    (${v} voice)`);
    });
    console.log('');
    console.log('  ⚡ EVALUATE:');
    console.log('     1. Did Whisper transcribe Georgian correctly?');
    console.log('     2. Did GPT respond naturally in Georgian?');
    console.log('     3. Listen to the TTS outputs — does Georgian sound good?');
    console.log('═══════════════════════════════════════════════════════');

  } catch (error) {
    console.error('\n❌ Pipeline failed:', error.message);
    if (error.code === 'invalid_api_key') {
      console.error('   → Check your OPENAI_API_KEY in spike/.env');
    }
    process.exit(1);
  }
}

main();
