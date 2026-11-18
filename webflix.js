// =============================================================
// Provider : Webflix
// Version : 1.1.0
//
// - Conservation de /api/fastflux
// - Champs language/provider compatibles avec le modèle fourni
// - Extraction du paramètre url des pages player4k.html
// - Conservation des liens video_proxy.php
// - Logs des réponses API activables
//
// Non testé contre l'API en direct.
// =============================================================

var DOMAINS_URL =
  'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';

var WEBFLIX_DOMAIN = 'webflix.surf';
var WEBFLIX_FALLBACK_DOMAIN = 'webflix.surf';

var WEBFLIX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

// Attention : les logs peuvent contenir des liens temporaires.
var WEBFLIX_DEBUG = true;

var _cachedEndpoint = null;

function debug(label, value) {
  if (!WEBFLIX_DEBUG) return;

  console.log(
    '[Webflix] ' + label + '\n' +
    JSON.stringify(value, null, 2)
  );
}

function buildEndpoint(domain) {
  return {
    base: 'https://' + domain,
    api: 'https://' + domain + '/api/fastflux',
    referer: 'https://' + domain + '/'
  };
}

function getHeaders(endpoint) {
  return {
    'User-Agent': WEBFLIX_UA,
    'Referer': endpoint.referer,
    'Origin': endpoint.base,
    'Accept': 'application/json'
  };
}

function fetchJson(url, options, label) {
  return fetch(url, options || {})
    .then(function(res) {
      if (!res.ok) {
        throw new Error((label || 'Requête') + ' HTTP ' + res.status);
      }

      return res.json();
    })
    .then(function(data) {
      if (label) debug(label, data);
      return data;
    });
}

// ─── Domaine dynamique ───────────────────────────────────────

function detectEndpoint() {
  if (_cachedEndpoint) return Promise.resolve(_cachedEndpoint);

  return fetchJson(DOMAINS_URL, {}, 'Domaines')
    .then(function(data) {
      var value = data && data.wbflix;

      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Clé wbflix absente ou invalide');
      }

      value = value.trim()
        .replace(/^https?:\/\//i, '')
        .split('/')[0];

      // Accepte "surf" ou "webflix.surf".
      WEBFLIX_DOMAIN = /^webflix\./i.test(value)
        ? value
        : 'webflix.' + value;

      _cachedEndpoint = buildEndpoint(WEBFLIX_DOMAIN);
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn(
        '[Webflix] Domaine dynamique indisponible : ' +
        (err.message || err)
      );

      WEBFLIX_DOMAIN = WEBFLIX_FALLBACK_DOMAIN;
      _cachedEndpoint = buildEndpoint(WEBFLIX_DOMAIN);

      return _cachedEndpoint;
    });
}

// ─── Métadonnées TMDB ────────────────────────────────────────

function getTmdbMetadata(tmdbId, mediaType) {
  var kind = mediaType === 'tv' ? 'tv' : 'movie';
  var url =
    'https://api.themoviedb.org/3/' + kind + '/' +
    encodeURIComponent(tmdbId) +
    '?api_key=' + encodeURIComponent(TMDB_KEY) +
    '&language=fr-FR';

  return fetchJson(url)
    .then(function(data) {
      var runtimes = data.episode_run_time;
      var duration = data.runtime ||
        (Array.isArray(runtimes) ? runtimes[0] : null);

      return {
        name: data.title || data.name || 'Webflix',
        year: String(
          data.release_date || data.first_air_date || ''
        ).split('-')[0],
        duration: duration ? String(duration) + ' min' : ''
      };
    })
    .catch(function() {
      return {
        name: 'Webflix',
        year: '',
        duration: ''
      };
    });
}

function getEpisodeInfo(tmdbId, season, episode) {
  var url =
    'https://api.themoviedb.org/3/tv/' +
    encodeURIComponent(tmdbId) +
    '/season/' + season +
    '/episode/' + episode +
    '?api_key=' + encodeURIComponent(TMDB_KEY) +
    '&language=fr-FR';

  return fetchJson(url)
    .then(function(data) {
      return {
        name: data.name || '',
        duration: data.runtime ? String(data.runtime) + ' min' : ''
      };
    })
    .catch(function() {
      return null;
    });
}

// ─── API Webflix ─────────────────────────────────────────────

function fetchSources(endpoint, tmdbId, mediaType, season, episode) {
  // Conserve le fonctionnement de ton code :
  // movie pour les films, episode pour les épisodes.
  var type = mediaType === 'tv' ? 'episode' : 'movie';

  var url =
    endpoint.api +
    '?type=' + type +
    '&tmdb_id=' + encodeURIComponent(tmdbId);

  if (mediaType === 'tv') {
    url += '&season=' + season + '&episode=' + episode;
  }

  console.log('[Webflix] Requête : ' + url);

  return fetchJson(
    url,
    { method: 'GET', headers: getHeaders(endpoint) },
    'Réponse API brute'
  ).then(function(data) {
    if (!data || data.success === false || data.available === false) {
      return [];
    }

    var payload = data.data;

    if (!payload) return [];

    // Réponse d'origine : data = un objet source.
    // Supporte aussi un tableau si l'API en renvoie un.
    if (Array.isArray(payload)) return payload;

    if (Array.isArray(payload.sources)) {
      return payload.sources;
    }

    return [payload];
  });
}

// ─── Résolution des adresses ─────────────────────────────────

function getQueryParam(url, key) {
  var queryIndex = url.indexOf('?');
  if (queryIndex === -1) return null;

  var parts = url.slice(queryIndex + 1).split('#')[0].split('&');

  for (var i = 0; i < parts.length; i++) {
    var equalIndex = parts[i].indexOf('=');
    if (equalIndex === -1) continue;

    var paramName = parts[i].slice(0, equalIndex);

    if (paramName !== key) continue;

    try {
      return decodeURIComponent(
        parts[i].slice(equalIndex + 1).replace(/\+/g, ' ')
      );
    } catch (err) {
      return null;
    }
  }

  return null;
}

function resolveStreamUrl(rawUrl, endpoint) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  var url = rawUrl.trim().replace(/&amp;/g, '&');

  if (url.indexOf('//') === 0) {
    url = 'https:' + url;
  } else if (url.charAt(0) === '/') {
    url = endpoint.base + url;
  }

  if (!/^https?:\/\//i.test(url)) return null;

  // Une page de lecteur n'est pas un flux :
  // on extrait l'adresse déjà présente dans son paramètre url.
  if (/\/player4k\.html(?:[?#]|$)/i.test(url)) {
    var embedded = getQueryParam(url, 'url');

    if (!embedded || embedded === url) return null;

    return resolveStreamUrl(embedded, endpoint);
  }

  // Ce chemin opaque n'est pas confirmé comme flux direct.
  if (/\/api\/v\/z\//i.test(url)) {
    console.warn(
      '[Webflix] Chemin embed non résolu, source ignorée : ' + url
    );
    return null;
  }

  // Conserve notamment video_proxy.php et son mécanisme
  // de redirection. Aucun jeton ff n'est généré ici.
  return url;
}

// ─── Formatage ───────────────────────────────────────────────

function parseLanguage(value) {
  var text = String(value || 'VF').toUpperCase();

  if (text.indexOf('MULTI') !== -1) return 'MULTI';
  if (text.indexOf('VOST') !== -1) return 'VOSTFR';

  if (
    text.indexOf('VF') !== -1 ||
    text === 'FR' ||
    text === 'FRENCH'
  ) {
    return 'VF';
  }

  if (text === 'EN' || text === 'ENGLISH' || text === 'VO') {
    return 'VO';
  }

  return text;
}

function parseQuality(value) {
  var text = String(value || '').toUpperCase();

  if (!text || text === 'UNKNOWN') return 'HD';
  if (/4K|2160/.test(text)) return '4K';
  if (/1080|FHD/.test(text)) return '1080p';
  if (/720/.test(text)) return '720p';
  if (/480/.test(text)) return '480p';

  return text;
}

function detectFormat(url, value) {
  var text = String(value || '').toLowerCase();

  if (text === 'hls' || text === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(url)) {
    return 'M3U8';
  }

  if (text === 'mp4' || /\.mp4(?:[?#&]|$)/i.test(url)) {
    return 'MP4';
  }

  return '';
}

function normalizeSource(
  source,
  endpoint,
  meta,
  mediaType,
  season,
  episode,
  epInfo
) {
  if (!source || typeof source !== 'object') return null;

  var streamUrl = resolveStreamUrl(source.url, endpoint);
  if (!streamUrl) return null;

  var title = String(source.title || meta.name);
  var year = String(source.year || meta.year || '');
  var quality = parseQuality(source.quality);
  var language = parseLanguage(source.language || source.lang);
  var format = detectFormat(
    streamUrl,
    source.format || source.type
  );

  var line1;

  if (mediaType === 'tv') {
    line1 =
      'S' + season + ' E' + episode +
      (epInfo && epInfo.name ? ' - ' + epInfo.name : '') +
      ' | ' + title;
  } else {
    line1 = title + (year ? ' (' + year + ')' : '');
  }

  var specs = [quality, language];

  if (format) specs.push(format);

  var duration = epInfo && epInfo.duration
    ? epInfo.duration
    : meta.duration;

  if (duration) specs.push(duration);

  var size = source.size == null ? '' : String(source.size);
  if (size) specs.push(size);

  var headers = {
    'User-Agent': WEBFLIX_UA,
    'Referer': endpoint.referer
  };

  // Conserve seulement des valeurs string pour Map<String, String>.
  if (source.headers && typeof source.headers === 'object') {
    Object.keys(source.headers).forEach(function(key) {
      if (typeof source.headers[key] === 'string') {
        headers[key] = source.headers[key];
      }
    });
  }

  var result = {
    name: 'Webflix - ' + quality + ' ' + language,
    title: line1 + '\n' + specs.join(' | '),
    url: streamUrl,
    quality: quality,
    language: language,
    provider: 'Webflix',
    headers: headers
  };

  if (size) result.size = size;

  return result;
}

// ─── Point d'entrée ──────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === 'series' ? 'tv' : mediaType;

  if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv')) {
    console.error('[Webflix] Identifiant ou type de média invalide');
    return Promise.resolve([]);
  }

  if (mediaType === 'tv') {
    season = Number(season);
    episode = Number(episode);

    if (
      !isFinite(season) || season < 0 || Math.floor(season) !== season ||
      !isFinite(episode) || episode < 1 || Math.floor(episode) !== episode
    ) {
      console.error('[Webflix] Saison ou épisode invalide');
      return Promise.resolve([]);
    }
  }

  return Promise.all([
    detectEndpoint(),
    getTmdbMetadata(tmdbId, mediaType),
    mediaType === 'tv'
      ? getEpisodeInfo(tmdbId, season, episode)
      : Promise.resolve(null)
  ])
    .then(function(context) {
      var endpoint = context[0];
      var meta = context[1];
      var epInfo = context[2];

      return fetchSources(
        endpoint,
        tmdbId,
        mediaType,
        season,
        episode
      ).then(function(sources) {
        var results = [];

        sources.forEach(function(source) {
          try {
            var result = normalizeSource(
              source,
              endpoint,
              meta,
              mediaType,
              season,
              episode,
              epInfo
            );

            if (result) results.push(result);
          } catch (err) {
            console.warn(
              '[Webflix] Source ignorée : ' + (err.message || err)
            );
          }
        });

        debug('Résultats normalisés', results);
        console.log('[Webflix] Sources trouvées : ' + results.length);

        return results;
      });
    })
    .catch(function(err) {
      console.error('[Webflix] Erreur : ' + (err.message || err));
      return [];
    });
}

// ─── Export ──────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
} else if (typeof global !== 'undefined') {
  global.getStreams = getStreams;
}
