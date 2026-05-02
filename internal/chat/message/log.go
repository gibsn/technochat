package message

import "fmt"

func DataForLog(data interface{}) string {
	switch v := data.(type) {
	case nil:
		return "nil"
	case string:
		return fmt.Sprintf("string_len=%d", len(v))
	case map[string]interface{}:
		return mapDataForLog(v)
	default:
		return fmt.Sprintf("type=%T", data)
	}
}

func mapDataForLog(data map[string]interface{}) string {
	alg, _ := data["alg"].(string)
	iv, _ := data["iv"].(string)
	ciphertext, _ := data["ciphertext"].(string)

	if alg != "" || iv != "" || ciphertext != "" {
		return fmt.Sprintf(
			"encrypted alg=%q iv_len=%d ciphertext_len=%d",
			alg, len(iv), len(ciphertext),
		)
	}

	return fmt.Sprintf("map_keys=%d", len(data))
}
