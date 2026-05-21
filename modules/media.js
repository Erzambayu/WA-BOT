const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Load environment variables
require('dotenv').config();

// API Keys - menggunakan environment variables
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'your_tmdb_api_key_here';
const JIKAN_API_URL = 'https://api.jikan.moe/v4';
const GENIUS_API_KEY = process.env.GENIUS_API_KEY || 'your_genius_api_key_here';

// Fungsi untuk kompres media
async function compressMedia(buffer, type) {
    if (type === 'image') {
        return await sharp(buffer)
            .resize(800, 800, { fit: 'inside' })
            .jpeg({ quality: 80 })
            .toBuffer();
    } else if (type === 'video') {
        const inputPath = '/tmp/input_' + Date.now() + '.mp4';
        const outputPath = '/tmp/output_' + Date.now() + '.mp4';
        fs.writeFileSync(inputPath, buffer);
        await execPromise(`ffmpeg -i ${inputPath} -vf "scale=640:-1" -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 128k ${outputPath}`);
        const compressedBuffer = fs.readFileSync(outputPath);
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
        return compressedBuffer;
    }
}

// Fungsi untuk ekstrak audio
async function extractAudio(videoBuffer) {
    const inputPath = '/tmp/input_' + Date.now() + '.mp4';
    const outputPath = '/tmp/output_' + Date.now() + '.mp3';
    fs.writeFileSync(inputPath, videoBuffer);
    await execPromise(`ffmpeg -i ${inputPath} -vn -acodec libmp3lame -q:a 2 ${outputPath}`);
    const audioBuffer = fs.readFileSync(outputPath);
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
    return audioBuffer;
}

// Fungsi untuk cari lirik lagu
async function searchLyrics(query) {
    const response = await axios.get(`https://api.genius.com/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${GENIUS_API_KEY}` }
    });
    if (!response.data.response.hits.length) {
        return null;
    }
    const song = response.data.response.hits[0].result;
    const lyricsResponse = await axios.get(`https://api.genius.com/songs/${song.id}`, {
        headers: { 'Authorization': `Bearer ${GENIUS_API_KEY}` }
    });
    return {
        title: song.title,
        artist: song.primary_artist.name,
        url: song.url,
        lyrics: lyricsResponse.data.response.song.description.plain
    };
}

// Helper function to safely convert to string
const safeToString = (value) => {
    if (value === null || value === undefined) return 'Unknown';
    return String(value);
};

// Fungsi untuk cari info film
async function searchMovie(query) {
    try {
        console.log('Searching for movie:', query);
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
        console.log('Request URL:', url);
        
        const response = await axios.get(url);
        console.log('Search response:', response.data);
        
        if (!response.data.results || response.data.results.length === 0) {
            return null;
        }

        // Ambil 3 hasil pencarian teratas
        const movies = response.data.results.slice(0, 3).map(movie => {
            return {
                title: movie.title || 'Unknown',
                overview: movie.overview || 'No overview available',
                release_date: movie.release_date || 'Unknown',
                rating: movie.vote_average ? movie.vote_average.toString() : '0',
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                id: movie.id
            };
        });

        // Jika hanya ada 1 hasil, langsung kembalikan detail filmnya
        if (movies.length === 1) {
            try {
                const detailsUrl = `https://api.themoviedb.org/3/movie/${movies[0].id}?api_key=${TMDB_API_KEY}`;
                console.log('Details URL:', detailsUrl);
                
                const detailsResponse = await axios.get(detailsUrl);
                console.log('Details response:', detailsResponse.data);
                
                const movie = detailsResponse.data;
                return {
                    title: movie.title || 'Unknown',
                    overview: movie.overview || 'No overview available',
                    release_date: movie.release_date || 'Unknown',
                    rating: movie.vote_average ? movie.vote_average.toString() : '0',
                    runtime: movie.runtime ? movie.runtime.toString() : '0',
                    genres: movie.genres ? movie.genres.map(g => g.name).join(', ') : 'Unknown',
                    status: movie.status || 'Unknown',
                    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null
                };
            } catch (e) {
                console.error('Error fetching movie details:', e);
                return movies[0];
            }
        }

        // Jika ada lebih dari 1 hasil, kembalikan daftar film
        return {
            multiple: true,
            movies: movies
        };
    } catch (e) {
        console.error('Error in searchMovie:', e);
        throw e;
    }
}

// Fungsi untuk cari info anime
async function searchAnime(query) {
    const response = await axios.get(`${JIKAN_API_URL}/anime?q=${encodeURIComponent(query)}`);
    if (!response.data.data.length) {
        return null;
    }
    const anime = response.data.data[0];
    return {
        title: anime.title,
        synopsis: anime.synopsis,
        episodes: anime.episodes,
        status: anime.status,
        score: anime.score,
        image: anime.images.jpg.large_image_url,
        genres: anime.genres.map(g => g.name).join(', '),
        aired: anime.aired.string,
        rating: anime.rating
    };
}

module.exports = {
    compressMedia,
    extractAudio,
    searchLyrics,
    searchMovie,
    searchAnime,
    TMDB_API_KEY
}; 