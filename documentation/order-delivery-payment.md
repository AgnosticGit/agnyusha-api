# Заказ, доставка и оплата

Покупатель собирает корзину и оформляет заказ. Деньги идут через Ozon Pay. Заявка перевозчику создаётся **после** оплаты. Если Ozon Pay не настроен, заявка создаётся сразу, а статус оплаты не выставляется.

Общая карта сервисов — [how-the-site-works.md](./how-the-site-works.md). Дальше статусы отправления читает поллер — [delivery-status-polling.md](./delivery-status-polling.md).

```mermaid
flowchart TD
  cart["Корзина: товар и выбранный вес"]
  checkout["Checkout: город, способ, ПВЗ или слот самовывоза, контакты"]
  stock{"Учёт остатков включён?"}
  dec["Списать stock выбранных фасовок"]
  skipStock["Остаток не трогаем"]
  save["Заказ NEW в Postgres<br/>номер, состав, pickupCode, сумма"]
  payOn{"Ozon Pay настроен?"}

  shipNow["Сразу создать заявку перевозчика"]
  pay["Ozon Pay POST /createOrder<br/>копейки, extId = номер заказа<br/>success / fail / webhook"]
  browser["Браузер на payLink<br/>корзина уже очищена от этих позиций"]
  paid{"Оплата прошла?"}
  failPage["/payment/fail<br/>заказ остаётся NEW"]
  hook["Webhook /api/payments/ozon/webhook<br/>или confirm со страницы успеха"]
  mark["PAID + paidAt<br/>письма покупателю и сотрудникам"]
  shipAfter["Создать заявку перевозчика,<br/>если внешнего id ещё нет"]

  method{"Способ доставки"}
  yandex["Яндекс: offers/create<br/>наш ПВЗ сдачи → ПВЗ покупателя<br/>затем offers/confirm → request_id"]
  cdek["СДЭК: заказ на ПВЗ<br/>uuid и трек"]
  pochta["Почта: отправление<br/>id и ШПИ"]
  ozonDel["Ozon Delivery: заказ<br/>номер и трек"]
  pickupStore["Самовывоз: дата и адрес в заказе,<br/>внешнего API нет"]
  saved["Пишем externalDeliveryId и трек"]
  poll["Поллер СДЭК / Яндекс / Почта<br/>статус сайта только вперёд"]

  cart --> checkout --> stock
  stock -->|"да"| dec --> save
  stock -->|"нет"| skipStock --> save
  save --> payOn
  payOn -->|"нет"| shipNow --> method
  payOn -->|"да"| pay --> browser --> paid
  paid -->|"нет"| failPage
  paid -->|"да"| hook --> mark --> shipAfter --> method
  method -->|"Яндекс"| yandex --> saved
  method -->|"СДЭК"| cdek --> saved
  method -->|"Почта"| pochta --> saved
  method -->|"Ozon Delivery"| ozonDel --> saved
  method -->|"Самовывоз"| pickupStore
  saved --> poll
```

Самовывоз и оплата не мешают друг другу: при включённом Ozon Pay заказ тоже ждёт `PAID`, но заявку никуда не отправляет. Ozon Delivery в создании заявки есть, на витрине метод обычно последний и недоступен для выбора.

## Яндекс после оплаты

Точка сдачи — `YANDEX_PLATFORM_STATION_ID` (ПВЗ, куда вы приносите посылку). ПВЗ покупателя — `pickupCode` из чекаута. В оффере `last_mile_policy = self_pickup`, оплата в биллинге `already_paid`.

Если `offers/create` или `confirm` упадут, заказ уже `PAID`. Ошибка остаётся в логе, внешний id пустой. Следующая пометка «оплачен» (повтор webhook или confirm) пробует создать заявку снова. То же для СДЭК, Почты и Ozon Delivery.

До оплаты заявка перевозчику не создаётся. Если создание платежа само упало, заказ `NEW` удаляется.

## Что видит покупатель

| Шаг | Статус заказа |
|---|---|
| Нажал «оформить», платёж создан | `NEW` |
| Закрыл оплату или Ozon вернул fail | `NEW`, ссылку можно открыть снова |
| Деньги прошли | `PAID` — «Собирается» |
| Перевозчик принял после сдачи | Передан в доставку → в пути → можно забирать → получен |
| Заявки у перевозчика больше нет | `ARCHIVED`, кроме уже полученного или отменённого |
