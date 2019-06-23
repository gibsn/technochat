FROM nginx

EXPOSE 80 443

ARG DEV

COPY static /static/
COPY dist/process_static.sh ./

RUN if [ "$DEV" != True ]; then /bin/bash ./process_static.sh; fi
RUN ["rm", "-f", "process_static.sh"]
