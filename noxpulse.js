// =============================================================
// Provider Nuvio : NoxPulse (VF / VOSTFR / MULTI)
// Version : 1.0.0
// - Header: NoxPulse - Quality
// - Ajout des métadonnées TMDB, année, durée et émojis UI
// - Domaine dynamique via domains.json (clé "nox")
// - Fallback: noxpulse.cc
// =============================================================

var TMDB_KEY       = 'f3d757824f08ea2cff45eb8f47ca3a1e';
var NOXPULSE_UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var DOMAINS_URL    = 'https://raw.githubusercontent.com/iokza/NoAds4Website/refs/heads/main/domains.json';
var NOXPULSE_DOMAIN = 'noxpulse.cc'; // fallback

var _cachedEndpoint = null;

// ─── TMDB Helpers ───────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var name = data.title || data.name || "NoxPulse";
      var date = data.release_date || data.first_air_date || "";
      var year = date ? date.split('-')[0] : "";

      var duration = "";
      if (type === 'movie' && data.runtime) {
          duration = data.runtime + ' min';
      } else if (type === 'tv' && data.episode_run_time && data.episode_run_time.length > 0) {
          duration = data.episode_run_time[0] + ' min';
      }

      return { name: name, year: year, duration: duration };
    })
    .catch(function() { return { name: "NoxPulse", year: "", duration: "" }; });
}

function getEpisodeInfo(tmdbId, season, episode) {
  if (!tmdbId || !season || !episode) return Promise.resolve(null);
  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '/episode/' + episode + '?api_key=' + TMDB_KEY + '&language=fr-FR';
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
          name: data.name || null,
          duration: data.runtime ? data.runtime + ' min' : null
      };
    })
    .catch(function() { return null; });
}

// ─── Construction de l'endpoint ──────────────────────────────

function buildEndpoint(domain) {
  return {
    base:    'https://' + domain,
    api:     'https://api.' + domain,
    referer: 'https://' + domain + '/'
  };
}

function detectEndpoint() {
  if (_cachedEndpoint) return Promise.resolve(_cachedEndpoint);
  return fetch(DOMAINS_URL)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var tld = data['nox'];
      if (!tld) throw new Error('Clé "nox" absente du domains.json');
      NOXPULSE_DOMAIN = 'noxpulse.' + tld;
      console.log('[NoxPulse] Domaine récupéré :', NOXPULSE_DOMAIN);
      _cachedEndpoint = buildEndpoint(NOXPULSE_DOMAIN);
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[NoxPulse] domains.json échoué :', err.message, '— fallback noxpulse.cc');
      _cachedEndpoint = buildEndpoint('noxpulse.cc');
      return _cachedEndpoint;
    });
}

// ─── UI / Formatting ─────────────────────────────────────────

function parseLangInfo(lang, title) {
  var text = String(lang || title || 'VF').toUpperCase();
  if (text.indexOf('MULTI') !== -1) return { icon: '🌍', label: 'MULTI' };
  if (text.indexOf('VOST') !== -1) return { icon: '🔡', label: 'VOSTFR' };
  if (text.indexOf('VO') !== -1 || text.indexOf('ENG') !== -1) return { icon: '🇬🇧', label: 'VO' };
  return { icon: '🇫🇷', label: 'VF' };
}

function parseQuality(q) {
  if (!q || q === 'Unknown') return 'HD';
  var s = String(q).toUpperCase();
  if (s.indexOf('4K') !== -1 || s.indexOf('2160') !== -1) return '4K';
  if (s.indexOf('1080') !== -1) return '1080p';
  if (s.indexOf('720') !== -1) return '720p';
  return s;
}

function normalizeSources(rawSources, meta, season, episode, epInfo) {
  var results = [];
  
  for (var i = 0; i < rawSources.length; i++) {
    var s = rawSources[i];
    if (!s || !s.url) continue;

    var quality = parseQuality(s.quality);
    var langInfo = parseLangInfo(s.language, s.title);
    var format = (s.type || s.kind || 'mp4').toLowerCase();

    var line1 = '🎬 ';
    if (season && episode) {
        var epTitle = epInfo && epInfo.name ? ' - ' + epInfo.name : '';
        line1 += 'S' + season + ' E' + episode + epTitle + ' | ' + meta.name;
    } else {
        line1 += meta.name + (meta.year ? ' (' + meta.year + ')' : '');
    }

    var specs = [
        '📺 ' + quality,
        langInfo.icon + ' ' + langInfo.label,
        '🎞️ ' + format.toUpperCase()
    ];
    if (s.size) specs.push('💾 ' + s.size);

    var finalDuration = (epInfo && epInfo.duration) ? epInfo.duration : meta.duration;
    if (finalDuration) specs.push('⏱️ ' + finalDuration);

    results.push({
      name: 'NoxPulse - ' + quality,
      title: line1 + '\n' + specs.join(' | '),
      url: s.url,
      quality: quality,
      format: format,
      headers: {
        'User-Agent': NOXPULSE_UA,
        'Referer': 'https://' + NOXPULSE_DOMAIN + '/'
      }
    });
  }
  return results;
}

// ─── Entry Point ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[NoxPulse] START tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);

  return Promise.all([
    getTmdbMetadata(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null),
    detectEndpoint()
  ]).then(function(results) {
    var meta     = results[0];
    var epInfo   = results[1];
    var endpoint = results[2];

    // Construction de l'URL NoxPulse : /watch/movie/{id} ou /watch/tv/{id}?season={s}&episode={e}
    var url = endpoint.api + '/watch/' + (mediaType === 'tv' ? 'tv' : 'movie') + '/' + tmdbId;
    if (mediaType === 'tv' && season && episode) {
      url += '?season=' + season + '&episode=' + episode;
    }

    return fetch(url, {
      headers: { 'User-Agent': NOXPULSE_UA, 'Referer': endpoint.referer }
    })
    .then(function(res) { 
      if (!res.ok) throw new Error('API HTTP ' + res.status);
      return res.json(); 
    })
    .then(function(data) {
      var list = [];
      
      // On extrait la source principale si elle existe
      if (data.source) {
        list.push(data.source);
      }
      // On fusionne avec le tableau "alternates" s'il y en a
      if (data.alternates && data.alternates.length > 0) {
        list = list.concat(data.alternates);
      }

      if (list.length === 0) return [];

      var sNum = mediaType === 'tv' ? season : null;
      var eNum = mediaType === 'tv' ? episode : null;

      return normalizeSources(list, meta, sNum, eNum, epInfo);
    });
  }).catch(function(err) { 
    console.error('[NoxPulse] Erreur globale :', err.message || err);
    return []; 
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
