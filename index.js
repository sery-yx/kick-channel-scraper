const cron = require('node-cron');

// Kick version of the Twitch channel scraper: every 15 minutes it takes the 5000 most watched live
// channels on Kick and adds the ones the rustlog-kick instance does not log yet.
//
// Environment variables:
//   KICK_CLIENT_ID, KICK_CLIENT_SECRET   credentials of a Kick app (kick.com/settings/developer),
//                                        for example the one rustlog-kick uses
//   RUSTLOG_URL                          address of the rustlog-kick instance, http://127.0.0.1:8025 if unset
//   RUSTLOG_API_KEY                      adminAPIKey of the instance

const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID;
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const INSTANCE_URL = (process.env.RUSTLOG_URL || 'http://127.0.0.1:8025').replace(/\/+$/, '');
const INSTANCE_API_KEY = process.env.RUSTLOG_API_KEY;

const CHANNEL_LIMIT = 5000;
// the most Kick returns per request (Twitch: 100)
const PAGE_SIZE = 1000;
// rustlog-kick looks up all channels of a request before it adds any of them, so a big backfill
// is sent in parts and a failure does not throw all of its progress away
const POST_SIZE = 500;

const missing = ['KICK_CLIENT_ID', 'KICK_CLIENT_SECRET', 'RUSTLOG_API_KEY'].filter(name => !process.env[name]);

if (missing.length > 0) {
    console.error(`missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
}

async function request(url, options = {}) {
    for (let attempt = 1; ; attempt++) {
        let response;

        try {
            response = await fetch(url, options);
        } catch (error) {
            throw new Error(`${options.method || 'GET'} ${url} failed: ${error.cause?.message || error.cause?.code || error.message}`);
        }

        // rate limited, wait for as long as Kick asks and try again
        if (response.status === 429 && attempt < 5) {
            await response.text();
            await new Promise(resolve => setTimeout(resolve, Math.min(Number(response.headers.get('retry-after')) || 1, 30) * 1000));

            continue;
        }

        if (!response.ok) {
            throw new Error(`${options.method || 'GET'} ${url} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
        }

        return response;
    }
}

async function getAccessToken() {
    const response = await request('https://id.kick.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: KICK_CLIENT_ID,
            client_secret: KICK_CLIENT_SECRET
        })
    });

    const data = await response.json();

    if (!data.access_token) {
        throw new Error('Kick did not return an access token');
    }

    return data.access_token;
}

async function fetchTopChannels() {
    const token = await getAccessToken();
    const viewers = new Map();
    const cursors = new Set();
    let cursor;

    // Kick can not sort livestreams by viewers (they come oldest first), so all of them are read
    // and the most watched ones are picked afterwards
    while (true) {
        const params = new URLSearchParams({ limit: PAGE_SIZE });

        if (cursor) params.set('cursor', cursor);

        const response = await request(`https://api.kick.com/public/v2/livestreams?${params}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        // the last page may come without a list
        if (data.data === null) data.data = [];

        if (!Array.isArray(data.data)) {
            throw new Error(`unexpected response from Kick: ${JSON.stringify(data).slice(0, 300)}`);
        }

        for (const channel of data.data) {
            // the user id of the streamer, which is what rustlog-kick calls the channel id
            // (not Kick's own channel id or chatroom id), as a string like the instance has it
            const userId = String(channel.broadcaster_user?.id || '');

            if (!userId) continue;

            viewers.set(userId, Math.max(viewers.get(userId) || 0, Number(channel.viewer_count) || 0));
        }

        cursor = data.pagination?.next_cursor;

        // the end of the list: no cursor, an empty page, or a cursor that was already used
        if (!cursor || data.data.length === 0 || cursors.has(cursor)) break;

        cursors.add(cursor);
    }

    return [...viewers].sort((a, b) => b[1] - a[1]).slice(0, CHANNEL_LIMIT).map(([userId]) => userId);
}

async function getInstanceChannels() {
    const response = await request(`${INSTANCE_URL}/channels`);

    const data = await response.json();

    if (!Array.isArray(data.channels)) {
        throw new Error(`unexpected response from ${INSTANCE_URL}/channels: ${JSON.stringify(data).slice(0, 300)}`);
    }

    return new Set(data.channels.map(c => String(c.userID)));
}

async function handle() {
    const [topChannels, instanceChannels] = await Promise.all([
        fetchTopChannels(),
        getInstanceChannels()
    ]);

    const newChannels = [];

    for (const channelId of topChannels) {
        if (instanceChannels.has(channelId)) continue;

        newChannels.push(channelId);
    }

    for (let i = 0; i < newChannels.length; i += POST_SIZE) {
        await request(`${INSTANCE_URL}/admin/channels`, {
            method: 'POST',
            headers: {
                'X-Api-Key': INSTANCE_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                channels: newChannels.slice(i, i + POST_SIZE)
            })
        });
    }

    console.log(`added ${newChannels.length} new channels to logs`);
}

cron.schedule('*/15 * * * *', () => {
    console.log(`Running job at ${new Date().toLocaleTimeString()}`);
    handle().catch(error => console.error(`job failed: ${error.message}`));
});
