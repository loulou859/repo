// ============================================================
// Provider Nuvio : Anime-Sama (anime-sama.to)
// Fix v7.3 :
//   - Slug construit directement depuis le titre (sans fetch.php)
//   - Saisons lues depuis l'URL directe (pas de JS dynamique)
//   - Filever extrait proprement
//   - Compatible Cinemeta (TMDB IDs)
// ============================================================

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
var LANGS = ['vf', 'vostfr'];
var MAX_SEASON_PROBE = 5; // On tente jusqu'à 5 saisons

var _cachedBase = null;
var _cache = {};

// ─── Détection domaine ────────────────────────────────────────

function detectBase() {
  if (_cachedBase) return Promise.resolve(_cachedBase);

  var candidates = [
    'https://anime-sama.to',
    'https://anime-sama.tv',
    'https://anime-sama.si',
    'https://anime-sama.eu',
  ];

  // Tester .to en premier directement
  return fetch('https://anime-sama.to/', {
    headers: { 'User-Agent': UA }
  }).then(function(r) {
    if (r.ok) {
      console.log('[AnimeSama] .to actif');
      _cachedBase = 'https://anime-sama.to';
      return _cachedBase;
    }
    throw new Error('ko');
  }).catch(function() {
    // Scraper anime-sama.pw pour trouver le bon domaine
    return fetch('https://anime-sama.pw/', { headers: { 'User-Agent': UA } })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var re = /https?:\/\/anime-sama\.([a-z]{2,10})/gi;
        var found = [], m, seen = {};
        while ((m = re.exec(html)) !== null) {
          var tld = m[1].toLowerCase();
          if (tld !== 'pw' && tld !== 'fr' && !seen[tld]) {
            seen[tld] = true;
            found.push('https://anime-sama.' + tld);
          }
        }
        // Tester dans l'ordre
        return found.concat(candidates).reduce(function(chain, base) {
          return chain.then(function(ok) {
            if (ok) return ok;
            return fetch(base + '/', { headers: { 'User-Agent': UA } })
              .then(function(r) { return r.ok ? base : null; })
              .catch(function() { return null; });
          });
        }, Promise.resolve(null));
      })
      .then(function(base) {
        _cachedBase = base || 'https://anime-sama.to';
        console.log('[AnimeSama] Domaine:', _cachedBase);
        return _cachedBase;
      })
      .catch(function() {
        _cachedBase = 'https://anime-sama.to';
        return _cachedBase;
      });
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function getText(url, referer) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': referer || 'https://anime-sama.to/',
      'Accept-Language': 'fr-FR,fr;q=0.9',
    }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

function getJson(url) {
  return fetch(url, {
    headers: { 'User-Agent': UA }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

// ─── TMDB → liste de titres candidats ────────────────────────

function getTitles(tmdbId, mediaType) {
  var type = mediaType === 'movie' ? 'movie' : 'tv';
  var url = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId
    + '?api_key=' + TMDB_KEY + '&language=fr-FR&append_to_response=alternative_titles';

  return getJson(url).then(function(d) {
    var seen = {}, out = [];
    function add(t) {
      t = (t || '').trim();
      if (t && !seen[t]) { seen[t] = 1; out.push(t); }
    }
    var frFull   = d.name || d.title || '';
    var frShort  = frFull.split(/\s*[:\-|]\s*/)[0];
    var orig     = d.original_name || d.original_title || '';
    var origShort = orig.split(/\s*[:\-|]\s*/)[0];
    add(frShort); add(frFull); add(origShort); add(orig);
    var alts = (d.alternative_titles || {}).results || (d.alternative_titles || {}).titles || [];
    alts.forEach(function(a) {
      var t = a.title || a.name || '';
      add(t.split(/\s*[:\-|]\s*/)[0]);
      add(t);
    });
    console.log('[AnimeSama] Titres:', out.slice(0, 5));
    return out;
  }).catch(function(e) {
    console.warn('[AnimeSama] TMDB fail:', e.message);
    return [];
  });
}

// ─── Titre → slug anime-sama ──────────────────────────────────
// anime-sama utilise ces règles pour ses slugs :
// - tout en minuscules
// - accents supprimés
// - caractères spéciaux → tiret
// - tirets multiples → un seul
// - pas de tiret en début/fin

function titleToSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/['''`]/g, '')                            // apostrophes
    .replace(/[^a-z0-9]+/g, '-')                       // non alphanum → tiret
    .replace(/^-+|-+$/g, '')                           // tirets en bord
    .replace(/-{2,}/g, '-');                            // tirets multiples
}

// Score de similarité slug ↔ titre
function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function score(title, slug) {
  var a = norm(title), b = norm(slug.replace(/-/g, ' '));
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.9;
  var wa = a.split(' '), wb = b.split(' ');
  var common = wa.filter(function(w) { return w.length > 2 && wb.indexOf(w) !== -1; });
  return common.length / Math.max(wa.length, wb.length, 1);
}

// ─── Vérification qu'un slug existe sur anime-sama ───────────
// On tente GET /catalogue/SLUG/ — si 200, le slug est valide

function slugExists(base, slug) {
  var url = base + '/catalogue/' + slug + '/';
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': base + '/' }
  }).then(function(r) {
    return r.ok;
  }).catch(function() { return false; });
}

// ─── Résolution du slug depuis les titres ────────────────────

function resolveSlug(tmdbId, titles, base) {
  if (_cache[tmdbId]) {
    console.log('[AnimeSama] Cache:', _cache[tmdbId]);
    return Promise.resolve(_cache[tmdbId]);
  }

  // Générer tous les slugs candidats depuis les titres
  var candidates = [];
  var seen = {};
  titles.forEach(function(title) {
    var slug = titleToSlug(title);
    if (slug && !seen[slug]) {
      seen[slug] = true;
      candidates.push({ slug: slug, title: title });
    }
  });

  console.log('[AnimeSama] Slugs candidats:', candidates.map(function(c) { return c.slug; }).slice(0, 6));

  // Tester chaque slug dans l'ordre (les premiers sont les plus probables)
  return candidates.reduce(function(chain, c) {
    return chain.then(function(found) {
      if (found) return found;
      return slugExists(base, c.slug).then(function(ok) {
        if (ok) {
          console.log('[AnimeSama] Slug validé:', c.slug);
          _cache[tmdbId] = c.slug;
          return c.slug;
        }
        return null;
      });
    });
  }, Promise.resolve(null)).then(function(slug) {
    if (!slug) console.warn('[AnimeSama] Aucun slug valide pour tmdbId=' + tmdbId);
    return slug;
  });
}

// ─── Filever + episodes.js ────────────────────────────────────

function getFilever(seasonUrl, base) {
  return getText(seasonUrl, base + '/').then(function(html) {
    var m = html.match(/episodes\.js\?filever=(\d+)/);
    if (m) { console.log('[AnimeSama] filever:', m[1]); return m[1]; }
    return null;
  }).catch(function() { return null; });
}

function parseEpsJs(js) {
  var result = {};
  var re = /var\s+(eps\w*)\s*=\s*\[([\s\S]*?)\]\s*;/g, m;
  while ((m = re.exec(js)) !== null) {
    var urls = [], u, urlRe = /['"]([^'"]+)['"]/g;
    while ((u = urlRe.exec(m[2])) !== null) {
      if (u[1].indexOf('http') === 0) urls.push(u[1]);
    }
    if (urls.length) result[m[1]] = urls;
  }
  return Object.keys(result).length ? result : null;
}

function fetchEpsForLang(base, slug, season, lang) {
  var seasonUrl = base + '/catalogue/' + slug + '/saison' + season + '/' + lang + '/';
  return getFilever(seasonUrl, base).then(function(filever) {
    var url = seasonUrl + 'episodes.js';
    if (filever) url += '?filever=' + filever;
    console.log('[AnimeSama] episodes.js:', url);
    return getText(url, seasonUrl);
  }).then(function(js) {
    return parseEpsJs(js);
  }).catch(function() { return null; });
}

// Essayer VF puis VOSTFR pour la saison donnée
function fetchEpisodes(base, slug, season) {
  return LANGS.reduce(function(chain, lang) {
    return chain.then(function(found) {
      if (found) return found;
      return fetchEpsForLang(base, slug, season, lang).then(function(eps) {
        if (eps) { console.log('[AnimeSama] Episodes trouvés en', lang); }
        return eps ? { eps: eps, lang: lang } : null;
      });
    });
  }, Promise.resolve(null));
}

// ─── Extracteurs embed ────────────────────────────────────────

function extractSendvid(url) {
  var embedUrl = url.replace(/sendvid\.com\/([a-z0-9]+)/i, 'sendvid.com/embed/$1');
  return fetch(embedUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://sendvid.com/' }
  }).then(function(r) { return r.text(); }).then(function(html) {
    var patterns = [
      /video_source\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /["'](https?:\/\/videos\d*\.sendvid\.com\/[^"'>\s]+\.mp4[^"'>\s]*)["']/i,
      /<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
      /file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m) return { url: m[1], fmt: m[1].indexOf('.m3u8') !== -1 ? 'm3u8' : 'mp4' };
    }
    return null;
  }).catch(function() { return null; });
}

function extractSibnet(shellUrl) {
  return fetch(shellUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://video.sibnet.ru/' }
  }).then(function(r) { return r.text(); }).then(function(html) {
    var m = /src\s*:\s*['"](\/v\/[^'"]+\.mp4)['"]/.exec(html)
         || /["']((?:https?:)?\/\/[^"'\s]+\.mp4)["']/.exec(html);
    if (!m) return null;
    var path = m[1];
    var resolved = path.startsWith('//') ? 'https:' + path
                 : path.startsWith('/')  ? 'https://video.sibnet.ru' + path
                 : path;
    return { url: resolved, fmt: 'mp4', referer: 'https://video.sibnet.ru/' };
  }).catch(function() { return null; });
}

function unpack(code) {
  try {
    if (code.indexOf('p,a,c,k,e,d') === -1) return code;
    var re = /eval\s*\(\s*function[\s\S]*?\}\s*\(([\s\S]*?)\)\s*\)/g;
    var m = re.exec(code);
    if (!m) return code;
    var args = m[1].match(/^'([\s\S]*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/s);
    if (!args) return code;
    var p = args[1].replace(/\\'/g, "'"), base = parseInt(args[2]);
    var words = args[4].split('|'), count = parseInt(args[3]);
    var toB = function(n) {
      return (n < base ? '' : toB(Math.floor(n / base)))
        + ((n = n % base) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    };
    var dict = {};
    while (count--) dict[toB(count)] = words[count] || toB(count);
    return p.replace(/\b\w+\b/g, function(w) { return dict[w] || w; });
  } catch(e) { return code; }
}

function extractVidmoly(url) {
  var u = url.replace(/vidmoly\.(net|to|ru|is)/i, 'vidmoly.me');
  return fetch(u, {
    headers: { 'User-Agent': UA, 'Referer': 'https://vidmoly.me/' }
  }).then(function(r) { return r.text(); }).then(function(html) {
    if (html.indexOf('p,a,c,k,e,d') !== -1) html = unpack(html);
    var m3 = /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(html)
           || /["'](https?:\/\/[^"']+\.m3u8)["']/i.exec(html);
    if (m3) return { url: m3[1], fmt: 'm3u8' };
    var m4 = /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i.exec(html);
    if (m4) return { url: m4[1], fmt: 'mp4' };
    return null;
  }).catch(function() { return null; });
}

function extractUrl(embedUrl) {
  if (!embedUrl) return Promise.resolve(null);
  // Serveurs anime-sama.fr morts → skip
  if (embedUrl.indexOf('anime-sama.fr') !== -1) return Promise.resolve(null);
  // URL directe mp4/m3u8
  if (/\.(mp4|m3u8)(\?|$)/i.test(embedUrl)) {
    return Promise.resolve({ url: embedUrl, fmt: /\.m3u8/i.test(embedUrl) ? 'm3u8' : 'mp4' });
  }
  if (embedUrl.indexOf('sendvid.com') !== -1) return extractSendvid(embedUrl);
  if (embedUrl.indexOf('sibnet.ru')   !== -1) {
    return extractSibnet(embedUrl).then(function(res) {
      return res ? { url: res.url, fmt: 'mp4', referer: res.referer } : null;
    });
  }
  if (embedUrl.indexOf('vidmoly')     !== -1) return extractVidmoly(embedUrl);
  return Promise.resolve(null);
}

// ─── Construction des streams ─────────────────────────────────

var PRIO   = { epsAS: 100, eps3: 70, eps2: 60, eps1: 50 };
var LABELS = { epsAS: 'Direct', eps1: 'Sibnet', eps2: 'Vidmoly', eps3: 'Sendvid' };

function buildStreams(epsData, epIdx, season, episode, base) {
  var flag = epsData.lang === 'vf' ? '[VF]' : '[VOSTFR]';
  var eps  = epsData.eps;
  var keys = Object.keys(eps).sort(function(a, b) { return (PRIO[b]||30) - (PRIO[a]||30); });

  return Promise.all(keys.map(function(key) {
    var embedUrl = (eps[key] || [])[epIdx];
    if (!embedUrl) return Promise.resolve(null);
    return extractUrl(embedUrl).then(function(res) {
      if (!res) return null;
      return {
        name:    'AnimeSama',
        title:   flag + ' ' + (LABELS[key] || key) + ' | S' + season + 'E' + episode,
        url:     res.url,
        quality: res.fmt === 'm3u8' ? 'HD' : 'Auto',
        format:  res.fmt,
        headers: { 'User-Agent': UA, 'Referer': res.referer || base + '/' },
        _prio:   PRIO[key] || 30
      };
    }).catch(function() { return null; });
  })).then(function(results) {
    return results.filter(Boolean)
      .sort(function(a, b) { return b._prio - a._prio; })
      .map(function(r) { delete r._prio; return r; });
  });
}

// ─── Interface publique ───────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  var s = season || 1, e = episode || 1, idx = e - 1;
  var activeBase;

  console.log('[AnimeSama] getStreams id=' + tmdbId + ' S' + s + 'E' + e);

  return detectBase()
    .then(function(base) {
      activeBase = base;
      return getTitles(tmdbId, mediaType);
    })
    .then(function(titles) {
      if (!titles.length) throw new Error('Pas de titres TMDB');
      return resolveSlug(tmdbId, titles, activeBase);
    })
    .then(function(slug) {
      if (!slug) throw new Error('Slug introuvable');
      return fetchEpisodes(activeBase, slug, s);
    })
    .then(function(epsData) {
      if (!epsData) throw new Error('Aucun épisode');
      return buildStreams(epsData, idx, s, e, activeBase);
    })
    .catch(function(err) {
      console.error('[AnimeSama] Erreur:', err && err.message || String(err));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
