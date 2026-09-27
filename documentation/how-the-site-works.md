# Как работает сайт Агнюша

Покупатель и админ открывают витрину. Caddy принимает HTTPS и отдаёт сайт (Next.js) и API (NestJS). Витрина ходит в API. Секреты живут в `.env` на VPS, не в образе.

Заказ, оплата и доставка — [order-delivery-payment.md](./order-delivery-payment.md). Опрос статусов перевозчиков — [delivery-status-polling.md](./delivery-status-polling.md).

```mermaid
flowchart TB
  buyer["Покупатель"]
  admin["Админ / сотрудник"]

  subgraph vps["VPS /opt/agnyusha"]
    caddy["Caddy :443"]
    web["Витрина Next.js<br/>каталог, товар, корзина, checkout, ЛК, админка"]
    api["API NestJS :3001"]
    db[("Postgres")]
  end

  buyer --> caddy
  admin --> caddy
  caddy --> web
  caddy --> api
  web -->|"прокси /api"| api
  api --> db

  subgraph shop["Что умеет витрина"]
    catalog["Каталог и вес фасовки"]
    cart["Корзина"]
    checkout["Оформление: город, доставка, контакты"]
    account["ЛК: заказы, отзывы"]
    adminUi["Админка: товары, заказы, настройки, health"]
  end

  web --- catalog
  web --- cart
  web --- checkout
  web --- account
  web --- adminUi

  subgraph pay["Оплата"]
    ozonPay["Ozon Pay<br/>createOrder / webhook / getOrderDetails"]
  end

  subgraph carriers["Доставка"]
    yandex["Яндекс NDD"]
    cdek["СДЭК"]
    pochta["Почта России"]
    ozonDel["Ozon Delivery"]
    pickup["Самовывоз<br/>только наша БД"]
  end

  subgraph other["Прочие сервисы"]
    resend["Resend<br/>magic link и письма о заказе"]
    google["Google OAuth"]
    sentry["Sentry"]
  end

  checkout --> api
  api --> ozonPay
  api --> yandex
  api --> cdek
  api --> pochta
  api --> ozonDel
  api --> pickup
  api --> resend
  api --> google
  api --> sentry
```

## Кто откуда берёт конфиг

| Что | Откуда на VPS |
|---|---|
| Домен, URL, тарифы, `YANDEX_PLATFORM_STATION_ID`, id способов отгрузки | `deploy/.env.example` при деплое |
| Пароли и токены: Postgres, Google, Resend, СДЭК, Яндекс, Почта, Ozon Pay, Ozon Delivery, Sentry | GitHub Secrets |
| Локальный `.env.production` и корневой `.env.example` | На сервер не едут |
