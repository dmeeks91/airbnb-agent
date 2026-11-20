import fs from 'node:fs/promises';
import path from 'node:path';
import { parseAirbnbEmail } from '../src/server/services/emailParser.ts';
import {
  detectDiscountAlert,
  hasDiscountIntent,
} from '../src/server/services/discountDetector.ts';
import { type PropertyPricing } from '../src/types/cohost.ts';

const DEFAULT_SAMPLE_DIR = path.resolve(process.cwd(), 'local-samples/airbnb-emails');

const SAMPLE_PRICING: PropertyPricing = {
  nightlyFloor: 150,
  cleaningFee: 120,
  localTaxPct: 14,
  hostServiceFeePct: 15.5,
};

async function main() {
  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SAMPLE_DIR;

  let entries: string[];
  try {
    entries = (await fs.readdir(targetDir)).filter((f) => f.toLowerCase().endsWith('.eml')).sort();
  } catch {
    console.error(`Sample directory not found: ${targetDir}`);
    process.exit(1);
  }

  if (entries.length === 0) {
    console.log(`No .eml files found in ${targetDir}`);
    console.log('Export 5 to 10 Airbnb emails from Gmail ("Download message") into that folder and re-run.');
    return;
  }

  console.log(`Inspecting ${entries.length} .eml file(s) in ${targetDir}\n`);

  for (const filename of entries) {
    const filePath = path.join(targetDir, filename);
    const raw = await fs.readFile(filePath);
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: filename });
    const guestTextForDiscount = parsed.messages
      .filter((m) => m.role === 'guest')
      .map((m) => m.body)
      .join('\n\n');
    const discountIntent = hasDiscountIntent(guestTextForDiscount);
    const discountAlert = detectDiscountAlert(guestTextForDiscount, parsed.nights, SAMPLE_PRICING);

    console.log('='.repeat(72));
    console.log(`FILE: ${filename}`);
    console.log(
      `CLASSIFICATION: ${parsed.classification} | NEEDS REPLY: ${parsed.needsHostReply}` +
        `${parsed.ignoreReason ? ` | REASON: ${parsed.ignoreReason}` : ''}`,
    );
    console.log(`TEMPLATE: ${parsed.airbnbTemplate ?? '(none)'}`);
    console.log(`SUBJECT: ${parsed.subject}`);
    console.log(`GUEST: ${parsed.guestName ?? '(none)'} | GUESTS: ${parsed.guestCount ?? '(none)'} | STAGE: ${parsed.stage}`);
    console.log(`STAY: ${parsed.stayDates ?? '(none)'} | NIGHTS: ${parsed.nights ?? '(unknown)'}`);
    console.log(`LISTING ID: ${parsed.airbnbListingId ?? '(none)'} | TITLE HINT: ${parsed.listingTitleHint ?? '(none)'}`);
    console.log(
      `THREAD ID: ${parsed.airbnbThreadId ?? '(none)'} | RES CODE: ${parsed.reservationCode ?? '(none)'}`,
    );
    console.log(`DEEP LINK: ${parsed.airbnbThreadUrl ?? '(none)'}`);
    console.log(`MESSAGES (${parsed.messages.length}):`);
    for (const msg of parsed.messages) {
      console.log(`  [${msg.role.toUpperCase()} - ${msg.senderName}]: ${msg.body}`);
    }
    if (discountIntent || discountAlert) {
      console.log(`DISCOUNT INTENT: ${discountIntent}`);
      if (discountAlert) {
        console.log(
          `DISCOUNT ALERT: $${discountAlert.offeredAmount} / ${discountAlert.nights}n (${discountAlert.matchedSnippet}) | ` +
            `all-in net/nt: $${discountAlert.allIn.estimatedNetPerNight} | ` +
            `room-only net/nt: $${discountAlert.roomOnly.estimatedNetPerNight}`,
        );
      }
    }
    console.log('');
  }
}

main().catch((error: unknown) => {
  console.error('Failed to inspect email samples:', error);
  process.exit(1);
});
