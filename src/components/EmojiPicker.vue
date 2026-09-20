<script setup lang="ts">

import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import { twemojiSvgUrl } from "@/utils/twemoji";
import { EMOJI_CATEGORIES, emojiMatchesQuery } from "@/config/emoji";

const emit = defineEmits<{ (event: "pick", emoji: string): void }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const search = ref("");
const category = ref("smileys");

function categoryLabel(id: string) {
  return t(`composer.emojiCategory.${id}`);
}

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return EMOJI_CATEGORIES;
  return EMOJI_CATEGORIES.map((cat) => ({
    ...cat,
    emojis: cat.emojis.filter((emoji) => emojiMatchesQuery(emoji, query))
  })).filter((cat) => cat.emojis.length > 0);
});

const active = computed(
  () => EMOJI_CATEGORIES.find((cat) => cat.id === category.value) || EMOJI_CATEGORIES[0]
);
</script>

<template>
  <div class="emoji-picker" role="menu" :aria-label="t('composer.emoji')">
    <div class="emoji-picker__search">
      <input v-model="search" type="text" class="emoji-picker__search-input"
        :placeholder="t('composer.emojiSearch')" :aria-label="t('composer.emojiSearch')" autocomplete="off"
        spellcheck="false" />
    </div>

    <div class="emoji-picker__tabs" role="tablist">
      <button v-for="cat in EMOJI_CATEGORIES" :key="cat.id" type="button" class="emoji-picker__tab"
        :class="{ 'is-active': category === cat.id }" role="tab" :aria-selected="category === cat.id"
        :aria-label="categoryLabel(cat.id)" :title="categoryLabel(cat.id)" @click="category = cat.id"><img
          class="emoji-picker__glyph" :src="twemojiSvgUrl(cat.emojis[0])" :alt="cat.emojis[0]"
          draggable="false" /></button>
    </div>

    <div v-if="search.trim()" class="emoji-picker__results">
      <template v-for="cat in filtered" :key="cat.id">
        <div class="emoji-picker__section-label">{{ categoryLabel(cat.id) }}</div>
        <div class="emoji-picker__grid">
          <button v-for="emoji in cat.emojis" :key="emoji" type="button" class="emoji-picker__cell"
            :aria-label="emoji" :title="emoji" @click="emit('pick', emoji)"><img class="emoji-picker__glyph"
              :src="twemojiSvgUrl(emoji)" :alt="emoji" draggable="false" decoding="async" /></button>
        </div>
      </template>
      <div v-if="!filtered.length" class="emoji-picker__section-label">{{ t('composer.emojiNoResult') }}</div>
    </div>

    <div v-else class="emoji-picker__results">
      <div class="emoji-picker__section-label">{{ categoryLabel(active.id) }}</div>
      <div class="emoji-picker__grid">
        <button v-for="emoji in active.emojis" :key="emoji" type="button" class="emoji-picker__cell"
          :aria-label="emoji" :title="emoji" @click="emit('pick', emoji)"><img class="emoji-picker__glyph"
            :src="twemojiSvgUrl(emoji)" :alt="emoji" draggable="false" decoding="async" /></button>
      </div>
    </div>
  </div>
</template>
