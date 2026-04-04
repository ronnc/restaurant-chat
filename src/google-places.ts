/**
 * Google Places API integration — ported from chat-client-toy Python tools.
 * Uses the Google Places API (New) endpoints.
 * Requires GOOGLE_PLACES_API_KEY env var.
 */

const PLACES_API_BASE = 'https://places.googleapis.com/v1/places';

const FIELD_MASK_NO_REVIEWS = [
  'displayName',
  'formattedAddress',
  'rating',
  'userRatingCount',
  'priceLevel',
  'currentOpeningHours',
  'internationalPhoneNumber',
  'websiteUri',
  'businessStatus',
  'types',
  'location',
].join(',');

const FIELD_MASK_WITH_REVIEWS = FIELD_MASK_NO_REVIEWS + ',reviews';

const PRICE_MAP: Record<string, string> = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not set in environment');
  return key;
}

function formatPlaceDetails(data: Record<string, any>, includeReviews: boolean): string {
  const lines: string[] = [];

  const name = data.displayName?.text ?? 'Unknown';
  const status = data.businessStatus ?? '';
  const statusEmoji = status === 'OPERATIONAL' ? '✅' : '⚠️';
  lines.push(`📍 ${name} ${statusEmoji}`, '');

  lines.push(`🗺️  Address: ${data.formattedAddress ?? 'Address not available'}`);

  const loc = data.location;
  if (loc) lines.push(`🧭 Coordinates: ${loc.latitude}, ${loc.longitude}`);
  lines.push('');

  if (data.rating != null) {
    const stars = '⭐'.repeat(Math.round(data.rating));
    const countStr = data.userRatingCount ? ` (${data.userRatingCount.toLocaleString()} reviews)` : '';
    lines.push(`⭐ Rating: ${data.rating}/5 ${stars}${countStr}`);
  }

  const price = PRICE_MAP[data.priceLevel ?? ''];
  if (price) lines.push(`💰 Price: ${price}`);
  lines.push('');

  const hours = data.currentOpeningHours;
  if (hours) {
    if (hours.openNow === true) lines.push('🕐 Currently: OPEN ✅');
    else if (hours.openNow === false) lines.push('🕐 Currently: CLOSED ❌');
    const weekdays: string[] = hours.weekdayDescriptions ?? [];
    if (weekdays.length) {
      lines.push('📅 Opening Hours:');
      for (const day of weekdays) lines.push(`   ${day}`);
    }
  }
  lines.push('');

  if (data.internationalPhoneNumber || data.websiteUri) {
    lines.push('📞 Contact:');
    if (data.internationalPhoneNumber) lines.push(`   Phone: ${data.internationalPhoneNumber}`);
    if (data.websiteUri) lines.push(`   Website: ${data.websiteUri}`);
    lines.push('');
  }

  const skipTypes = new Set(['point_of_interest', 'establishment', 'food', 'store']);
  const cleanTypes = (data.types ?? [])
    .filter((t: string) => !skipTypes.has(t))
    .slice(0, 5)
    .map((t: string) => t.replace(/_/g, ' '));
  if (cleanTypes.length) {
    lines.push(`🏷️  Type: ${cleanTypes.join(', ')}`, '');
  }

  if (includeReviews) {
    const reviews: any[] = data.reviews ?? [];
    if (reviews.length) {
      lines.push(`💬 Recent Reviews (${reviews.length} shown):`, '');
      for (let i = 0; i < Math.min(reviews.length, 5); i++) {
        const r = reviews[i];
        const author = r.authorAttribution?.displayName ?? 'Anonymous';
        const rRating = r.rating ?? '?';
        let rText = r.text?.text ?? '';
        const rTime = r.relativePublishTimeDescription ?? '';
        const stars = typeof rRating === 'number' ? '⭐'.repeat(rRating) : '';
        lines.push(`  ${i + 1}. ${author} — ${rRating}/5 ${stars} (${rTime})`);
        if (rText) {
          if (rText.length > 200) rText = rText.slice(0, 200) + '...';
          lines.push(`     "${rText}"`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

export async function getPlaceDetails(placeId: string, includeReviews = true): Promise<string> {
  try {
    const apiKey = getApiKey();
    const fieldMask = includeReviews ? FIELD_MASK_WITH_REVIEWS : FIELD_MASK_NO_REVIEWS;

    const resp = await fetch(`${PLACES_API_BASE}/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const status = resp.status;
      if (status === 403) return 'Error: Google Places API key is invalid or doesn\'t have Places API enabled.';
      if (status === 404) return 'Error: Place not found. The place_id may be incorrect.';
      if (status === 429) return 'Error: Google Places API quota exceeded. Try again later.';
      return `Error calling Google Places API (HTTP ${status})`;
    }

    const data = await resp.json();
    return formatPlaceDetails(data, includeReviews);
  } catch (e: any) {
    return `Error fetching place details: ${e.message}`;
  }
}

export async function getPlacePhotos(placeId: string, maxPhotos = 5, maxWidthPx = 800): Promise<string> {
  try {
    const apiKey = getApiKey();

    // Step 1: Fetch photo references
    const resp = await fetch(`${PLACES_API_BASE}/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'photos',
      },
    });

    if (!resp.ok) return `Error fetching photos from Google Places API (HTTP ${resp.status})`;
    const data = await resp.json();
    const photos: any[] = data.photos ?? [];
    if (!photos.length) return 'No photos found for this restaurant.';

    const limit = Math.min(maxPhotos, 10, photos.length);
    const results: string[] = [];

    // Step 2: Resolve photo URLs
    for (let i = 0; i < limit; i++) {
      const photo = photos[i];
      const photoName = photo.name ?? '';
      const author = photo.authorAttributions?.[0]?.displayName ?? 'Unknown';
      const width = photo.widthPx ?? '?';
      const height = photo.heightPx ?? '?';

      try {
        const mediaResp = await fetch(
          `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${apiKey}`,
          { redirect: 'manual' }
        );
        const photoUrl = mediaResp.headers.get('location') ?? '';
        if (photoUrl) {
          results.push(`![Photo by ${author}](${photoUrl})\n📷 *${author}*`);
        }
      } catch {
        // skip failed photo
      }
    }

    if (!results.length) return 'Could not resolve photo URLs.';
    return `📸 Photos (${results.length} found):\n\n${results.join('\n\n')}\n\n[Images are in markdown format — the chat will render them inline.]`;
  } catch (e: any) {
    return `Error fetching place photos: ${e.message}`;
  }
}
