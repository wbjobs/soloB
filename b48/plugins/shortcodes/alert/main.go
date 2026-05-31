package main

type AlertShortcode struct{}

var Shortcode AlertShortcode

func (a AlertShortcode) Name() string {
	return "alert"
}

func (a AlertShortcode) Render(params map[string]string, inner string, ctx map[string]interface{}) (string, error) {
	alertType := params["type"]
	if alertType == "" {
		alertType = "info"
	}

	title := params["title"]

	iconMap := map[string]string{
		"info":    "ℹ️",
		"warning": "⚠️",
		"success": "✅",
		"error":   "❌",
		"tip":     "💡",
	}

	colorMap := map[string]string{
		"info":    "#007bff",
		"warning": "#ffc107",
		"success": "#28a745",
		"error":   "#dc3545",
		"tip":     "#17a2b8",
	}

	icon := iconMap[alertType]
	if icon == "" {
		icon = iconMap["info"]
	}

	color := colorMap[alertType]
	if color == "" {
		color = colorMap["info"]
	}

	titleHTML := ""
	if title != "" {
		titleHTML = `<div style="font-weight: bold; margin-bottom: 8px;">` + icon + " " + title + `</div>`
	} else {
		titleHTML = icon + " "
	}

	return `<div style="
        padding: 16px;
        margin: 16px 0;
        border-left: 4px solid ` + color + `;
        background-color: #f8f9fa;
        border-radius: 0 4px 4px 0;
    ">` + titleHTML + inner + `</div>`, nil
}
