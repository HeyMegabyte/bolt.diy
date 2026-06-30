FROM dittofeed/dittofeed-lite:v0.24.0-alpha.17
COPY entrypoint-wrapper.sh /entrypoint-wrapper.sh
RUN chmod +x /entrypoint-wrapper.sh
EXPOSE 3000
ENTRYPOINT ["/entrypoint-wrapper.sh"]
