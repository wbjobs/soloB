package main

import (
	"fmt"
	"strings"
)

type VideoShortcode struct{}

var Shortcode VideoShortcode

func (v VideoShortcode) Name() string {
	return "video"
}

func (v VideoShortcode) Render(params map[string]string, inner string, ctx map[string]interface{}) (string, error) {
	id := params["id"]
	src := params["src"]
	width := params["width"]
	height := params["height"]
	platform := params["platform"]
	title := params["title"]

	if width == "" {
		width = "100%"
	}
	if height == "" {
		height = "400"
	}

	if id != "" {
		if platform == "" {
			platform = detectPlatform(id)
		}

		switch strings.ToLower(platform) {
		case "youtube", "yt":
			return renderYouTube(id, width, height, title), nil
		case "bilibili", "bili":
			return renderBilibili(id, width, height, title), nil
		case "vimeo":
			return renderVimeo(id, width, height, title), nil
		default:
			return renderGenericVideo(id, width, height, title), nil
		}
	}

	if src != "" {
		return renderHTML5Video(src, width, height, title, params, inner), nil
	}

	return "", fmt.Errorf("video shortcode requires either 'id' or 'src' parameter")
}

func detectPlatform(id string) string {
	if strings.HasPrefix(id, "BV") || strings.HasPrefix(id, "av") {
		return "bilibili"
	}
	if len(id) == 11 {
		return "youtube"
	}
	return "generic"
}

func renderYouTube(id, width, height, title string) string {
	titleAttr := ""
	if title != "" {
		titleAttr = fmt.Sprintf(` title="%s"`, title)
	}
	return fmt.Sprintf(
		`<div class="video-container video-youtube" style="position: relative; padding-bottom: 56.25%%; height: 0; overflow: hidden; max-width: %s;">
    <iframe src="https://www.youtube.com/embed/%s" 
            style="position: absolute; top: 0; left: 0; width: 100%%; height: 100%%;" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen%s></iframe>
</div>`, width, id, titleAttr)
}

func renderBilibili(id, width, height, title string) string {
	bvid := id
	
	titleAttr := ""
	if title != "" {
		titleAttr = fmt.Sprintf(` title="%s"`, title)
	}
	
	return fmt.Sprintf(
		`<div class="video-container video-bilibili" style="position: relative; padding-bottom: 56.25%%; height: 0; overflow: hidden; max-width: %s;">
    <iframe src="//player.bilibili.com/player.html?bvid=%s&high_quality=1" 
            style="position: absolute; top: 0; left: 0; width: 100%%; height: 100%%;" 
            scrolling="no" 
            border="0" 
            frameborder="no" 
            framespacing="0" 
            allowfullscreen="true"%s></iframe>
</div>`, width, bvid, titleAttr)
}

func renderVimeo(id, width, height, title string) string {
	titleAttr := ""
	if title != "" {
		titleAttr = fmt.Sprintf(` title="%s"`, title)
	}
	return fmt.Sprintf(
		`<div class="video-container video-vimeo" style="position: relative; padding-bottom: 56.25%%; height: 0; overflow: hidden; max-width: %s;">
    <iframe src="https://player.vimeo.com/video/%s" 
            style="position: absolute; top: 0; left: 0; width: 100%%; height: 100%%;" 
            frameborder="0" 
            allow="autoplay; fullscreen; picture-in-picture" 
            allowfullscreen%s></iframe>
</div>`, width, id, titleAttr)
}

func renderGenericVideo(id, width, height, title string) string {
	titleAttr := ""
	if title != "" {
		titleAttr = fmt.Sprintf(` title="%s"`, title)
	}
	return fmt.Sprintf(
		`<div class="video-container" style="max-width: %s;">
    <video controls height="%s" style="width: 100%%;"%s>
        <source src="%s" type="video/mp4">
        Your browser does not support the video tag.
    </video>
</div>`, width, height, titleAttr, id)
}

func renderHTML5Video(src, width, height, title string, params map[string]string, inner string) string {
	titleAttr := ""
	if title != "" {
		titleAttr = fmt.Sprintf(` title="%s"`, title)
	}
	
	posterAttr := ""
	if poster, ok := params["poster"]; ok {
		posterAttr = fmt.Sprintf(` poster="%s"`, poster)
	}
	
	innerContent := inner
	if innerContent != "" {
		innerContent = innerContent
	}
	
	return fmt.Sprintf(
		`<div class="video-container" style="max-width: %s;">
    <video controls height="%s" style="width: 100%%;"%s%s>
        <source src="%s" type="video/mp4">
        %s
        Your browser does not support the video tag.
    </video>
</div>`, width, height, titleAttr, posterAttr, src, innerContent)
}
