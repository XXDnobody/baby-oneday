# 天气响应回放

`qweather-hourly.json` 是和风天气官方公开示例坐标响应的最小化记录，不包含家庭地点、账号或凭据。保留实际返回的分钟精度 `forecastTime`，避免仅用带秒数的合成时间掩盖生产解析问题。

来源：[和风小时天气预报文档](https://dev.qweather.com/docs/api/weather/weather-hourly-forecast/)。测试会经过实际 `fetchWeather` 解析与规范化，并保留非法日期、无时区及非法偏移的拒绝检查。
