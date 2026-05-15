package http

import (
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const (
	roboHashPathPrefix    = "/api/v1/robohash/"
	roboHashAssetsDirPath = "static/images/robohash/set1"
	roboHashViewBox       = 300
	roboHashMaxSize       = 512
)

func (s *Server) roboHash(w http.ResponseWriter, r *http.Request) {
	text := strings.TrimPrefix(r.URL.Path, roboHashPathPrefix)
	text = strings.TrimSuffix(text, filepath.Ext(text))
	if text == "" {
		text = "example"
	}
	if unescaped, err := url.PathUnescape(text); err == nil {
		text = unescaped
	}

	width, height := roboHashSize(r.URL.Query().Get("size"))
	body, err := renderRoboHashSVG(text, width, height)
	if err != nil {
		log.Printf("error: http: could not render robohash avatar: %v", err)
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	w.WriteHeader(http.StatusOK)
	//nolint:gosec // SVG is generated from vendored PNG layers; user input only selects layer indexes.
	if _, err := w.Write([]byte(body)); err != nil {
		log.Printf("error: http: could not send robohash avatar: %v", err)
	}
}

func roboHashSize(size string) (int, int) {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return 50, 50
	}

	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil ||
		width < 1 || height < 1 ||
		width > roboHashMaxSize || height > roboHashMaxSize {
		return 50, 50
	}

	return width, height
}

func renderRoboHashSVG(text string, width, height int) (string, error) {
	layers, err := roboHashLayers(text)
	if err != nil {
		return "", err
	}

	var body strings.Builder
	fmt.Fprintf(
		&body,
		`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`,
		width, height, roboHashViewBox, roboHashViewBox,
	)

	for _, layer := range layers {
		data, err := os.ReadFile(layer)
		if err != nil {
			return "", fmt.Errorf("read robohash layer %s: %w", layer, err)
		}
		body.WriteString(`<image width="300" height="300" href="data:image/png;base64,`)
		body.WriteString(base64.StdEncoding.EncodeToString(data))
		body.WriteString(`"/>`)
	}

	body.WriteString(`</svg>`)
	return body.String(), nil
}

func roboHashLayers(text string) ([]string, error) {
	hash := sha512.Sum512([]byte(text))
	hashParts := splitRoboHash(hex.EncodeToString(hash[:]), 11)

	assetsDir, err := roboHashAssetsDir()
	if err != nil {
		return nil, err
	}

	colors, err := roboHashDirs(assetsDir)
	if err != nil {
		return nil, err
	}
	if len(colors) == 0 {
		return nil, fmt.Errorf("no robohash color directories found")
	}

	color := colors[roboHashHexInt(hashParts[0])%len(colors)]

	partSpecs := []struct {
		hashPart string
		dir      string
	}{
		{hashParts[7], "003#01Body"},
		{hashParts[8], "004#02Face"},
		{hashParts[5], "001#Eyes"},
		{hashParts[4], "000#Mouth"},
		{hashParts[6], "002#Accessory"},
	}

	layers := make([]string, 0, len(partSpecs))
	for _, spec := range partSpecs {
		files, err := roboHashPNGFiles(filepath.Join(color, spec.dir))
		if err != nil {
			return nil, err
		}
		if len(files) == 0 {
			return nil, fmt.Errorf("no robohash PNG files in %s", spec.dir)
		}
		layers = append(layers, files[roboHashHexInt(spec.hashPart)%len(files)])
	}

	return layers, nil
}

func roboHashAssetsDir() (string, error) {
	for _, dir := range []string{
		roboHashAssetsDirPath,
		filepath.Join("..", "..", roboHashAssetsDirPath),
	} {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir, nil
		}
	}

	return "", fmt.Errorf("robohash assets directory not found")
}

func roboHashDirs(root string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read robohash assets dir: %w", err)
	}

	dirs := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			dirs = append(dirs, filepath.Join(root, entry.Name()))
		}
	}
	sort.Strings(dirs)

	return dirs, nil
}

func roboHashPNGFiles(root string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read robohash part dir %s: %w", root, err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".png") {
			files = append(files, filepath.Join(root, entry.Name()))
		}
	}
	sort.Strings(files)

	return files, nil
}

func splitRoboHash(hash string, count int) []string {
	partLength := len(hash) / count
	parts := make([]string, count)
	for i := 0; i < count; i++ {
		start := i * partLength
		parts[i] = hash[start : start+partLength]
	}

	return append(parts, parts...)
}

func roboHashHexInt(hexStr string) int {
	num, err := strconv.ParseInt(hexStr, 16, 64)
	if err != nil {
		return 0
	}

	return int(num)
}
