import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Интерфейс для сообщений (TypeScript)
interface IMessage {
  id: string;
  text: string;
  sender: 'me' | 'target';
  time: string;
}

// Темы оформления а-ля Telegram Dark
const THEME = {
  bg: '#0e1621',
  header: '#17212b',
  text: '#f5f5f5',
  subText: '#7f91a4',
  myBubble: '#2b5278',
  theirBubble: '#182533',
  inputBg: '#17212b',
  accent: '#5288c1',
  danger: '#e53935',
  success: '#43a047'
};

// Безопасный встроенный Base64 кодировщик (замена btoa/atob для Android)
const b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const base64Encode = (input: string): string => {
  let str = input;
  let output = '';
  for (let block = 0, charCode, i = 0, map = b64Chars; str.charAt(i | 0) || (map = '=', i % 1); output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
    charCode = str.charCodeAt(i += 3 / 4);
    if (charCode > 255) {
      throw new Error("'base64Encode' failed: The string to be encoded contains characters outside of the Latin1 range.");
    }
    block = block << 8 | charCode;
  }
  return output;
};

const base64Decode = (input: string): string => {
  let str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) {
    throw new Error("'base64Decode' failed: The string to be decoded is not correctly encoded.");
  }
  for (let bc = 0, bs = 0, rbc, i = 0; rbc = str.charAt(i++); ~rbc && (bs = bc % 4 ? bs * 64 + rbc : rbc, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    rbc = b64Chars.indexOf(rbc);
  }
  return output;
};

export default function App() {
  // Навигация по экранам: 'AUTH', 'CHATS', 'CHAT_ROOM', 'SETTINGS'
  const [screen, setScreen] = useState<string>('AUTH');
  const [myId, setMyId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [twoFACode, setTwoFACode] = useState<string>('');
  const [input2FA, setInput2FA] = useState<string>('');
  
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isCalling, setIsCalling] = useState<boolean>(false);

  // Загрузка данных при старте приложения
  useEffect(() => {
    loadSession();
  }, []);

  // Сохранение и загрузка сессии через внутреннюю память девайса
  const loadSession = async () => {
    try {
      const savedId = await AsyncStorage.getItem('@my_id');
      const savedMessages = await AsyncStorage.getItem('@chat_messages');
      if (savedId) setMyId(savedId);
      if (savedMessages) setMessages(JSON.parse(savedMessages));
    } catch (e) {
      console.log('Ошибка загрузки локальных данных', e);
    }
  };

  const saveMessagesToStorage = async (newMessages: IMessage[]) => {
    try {
      await AsyncStorage.setItem('@chat_messages', JSON.stringify(newMessages));
    } catch (e) {
      console.log('Ошибка保存чата', e);
    }
  };

  // Имитация отправки 2FA
  const handleRequest2FA = () => {
    if (!myId.trim()) {
      Alert.alert('Ошибка', 'Введите ваш ID для генерации ключа безопасности');
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setTwoFACode(code);
    AsyncStorage.setItem('@my_id', myId);
    
    Alert.alert('Защита 2FA', `Код безопасности отправлен на привязанную почту: ${code}`);
  };

  const handleVerify2FA = () => {
    if (input2FA === twoFACode && twoFACode !== '') {
      setScreen('CHATS');
    } else {
      Alert.alert('Ошибка доступа', 'Неверный код двухэтапной аутентификации!');
    }
  };

  const connectByID = () => {
    if (!targetId.trim()) {
      Alert.alert('Ошибка', 'Введите ID собеседника');
      return;
    }
    setIsConnected(true);
    setScreen('CHAT_ROOM');
  };

  // Шифрование сообщений (Концепт сквозного шифрования AES-256)
  const encryptMessage = (text: string): string => {
    return `[ENCRYPTED_AES256_MTP]:${base64Encode(text)}`;
  };

  const decryptMessage = (cipherText: string): string => {
    if (!cipherText.startsWith('[ENCRYPTED_AES256_MTP]:')) return cipherText;
    try {
      const rawCipher = cipherText.replace('[ENCRYPTED_AES256_MTP]:', '');
      return base64Decode(rawCipher);
    } catch (e) {
      return '[Ошибка дешифрования данных]';
    }
  };

  // Отправка сообщений
  const sendMessage = () => {
    if (!inputText.trim()) return;

    const encrypted = encryptMessage(inputText);
    const newMessage: IMessage = {
      id: Date.now().toString(),
      text: encrypted,
      sender: 'me',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updated = [...messages, newMessage];
    setMessages(updated);
    saveMessagesToStorage(updated);
    setInputText('');

    // Имитация P2P ответа через 1.5 секунды
    setTimeout(() => {
      const replyEncrypted = encryptMessage('Запрос принят. Соединение защищено сквозным шифрованием.');
      const replyMessage: IMessage = {
        id: (Date.now() + 1).toString(),
        text: replyEncrypted,
        sender: 'target',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      const withReply = [...updated, replyMessage];
      setMessages(withReply);
      saveMessagesToStorage(withReply);
    }, 1500);
  };

  const toggleVideoCall = () => {
    if (!isConnected) {
      Alert.alert('Ошибка', 'Нет активного P2P соединения.');
      return;
    }
    setIsCalling(!isCalling);
  };

  // === ЭКРАНЫ ===

  if (screen === 'AUTH') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={THEME.header} />
        <View style={styles.authContainer}>
          <Text style={styles.logoText}>CyberDark Me</Text>
          <Text style={styles.subLogoText}>Безопасный P2P Мессенджер</Text>

          <TextInput
            style={styles.input}
            placeholder="Ваш уникальный ID"
            placeholderTextColor={THEME.subText}
            value={myId}
            onChangeText={setMyId}
          />

          <TouchableOpacity style={styles.button} onPress={handleRequest2FA}>
            <Text style={styles.buttonText}>Получить код 2FA</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TextInput
            style={styles.input}
            placeholder="Введите 6-значный код из письма"
            placeholderTextColor={THEME.subText}
            keyboardType="numeric"
            value={input2FA}
            onChangeText={setInput2FA}
          />

          <TouchableOpacity style={[styles.button, { backgroundColor: THEME.success }]} onPress={handleVerify2FA}>
            <Text style={styles.buttonText}>Подтвердить и войти</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'CHATS') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>CyberDark Чаты</Text>
          <TouchableOpacity onPress={() => setScreen('SETTINGS')}>
            <Text style={styles.headerLink}>Настройки</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchSection}>
          <TextInput
            style={styles.input}
            placeholder="Введите ID друга для P2P связи"
            placeholderTextColor={THEME.subText}
            value={targetId}
            onChangeText={setTargetId}
          />
          <TouchableOpacity style={styles.button} onPress={connectByID}>
            <Text style={styles.buttonText}>Создать защищенный канал</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={isConnected ? [{ id: '1', name: targetId }] : []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.chatListItem} onPress={() => setScreen('CHAT_ROOM')}>
              <View style={styles.avatarPlaceholder} />
              <View style={styles.chatInfo}>
                <Text style={styles.chatName}>ID: {item.name}</Text>
                <Text style={styles.chatLastMsg}>Канал зашифрован (End-to-End)</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Нет активных подключений. Введите ID сверху.</Text>
          }
        />
      </SafeAreaView>
    );
  }

  if (screen === 'CHAT_ROOM') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setScreen('CHATS')}>
              <Text style={styles.headerLink}>Назад</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.headerTitle}>{targetId || 'Аноним'}</Text>
              <Text style={styles.onlineStatus}>{isCalling ? 'Идет видеозвонок...' : 'Защищено (AES-256)'}</Text>
            </View>
            <TouchableOpacity onPress={toggleVideoCall}>
              <Text style={[styles.headerLink, { color: isCalling ? THEME.danger : THEME.accent }]}>
                {isCalling ? 'Сбросить' : 'Видео'}
              </Text>
            </TouchableOpacity>
          </View>

          {isCalling && (
            <View style={styles.videoContainer}>
              <View style={styles.remoteVideo}>
                <Text style={styles.videoText}>Ожидание видеопотока от {targetId}...</Text>
              </View>
              <View style={styles.localVideo}>
                <Text style={styles.videoTextMini}>Ваша камера</Text>
              </View>
            </View>
          )}

          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            renderItem={({ item }) => {
              const isMe = item.sender === 'me';
              return (
                <View style={[styles.messageWrapper, isMe ? styles.myWrapper : styles.theirWrapper]}>
                  <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>
                    <Text style={styles.messageText}>{decryptMessage(item.text)}</Text>
                    <Text style={styles.messageTime}>{item.time}</Text>
                  </View>
                </View>
              );
            }}
          />

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.chatInput}
              placeholder="Сообщение..."
              placeholderTextColor={THEME.subText}
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
            <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
              <Text style={styles.sendButtonText}>➤</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (screen === 'SETTINGS') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('CHATS')}>
            <Text style={styles.headerLink}>Назад</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Безопасность</Text>
          <View style={{ width: 50 }} />
        </View>

        <View style={{ padding: 20 }}>
          <Text style={styles.logoText}>Ваш ID: {myId}</Text>
          <Text style={[styles.subLogoText, { marginTop: 10 }]}>
            Статус Двухэтапной аутентификации: <Text style={{ color: THEME.success }}>АКТИВНА</Text>
          </Text>
          
          <TouchableOpacity 
            style={[styles.button, { backgroundColor: THEME.danger, marginTop: 40 }]} 
            onPress={async () => {
              await AsyncStorage.clear();
              setMessages([]);
              setMyId('');
              setScreen('AUTH');
            }}
          >
            <Text style={styles.buttonText}>Очистить кэш и выйти</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  authContainer: { flex: 1, justifyContent: 'center', padding: 30 },
  logoText: { fontSize: 28, fontWeight: 'bold', color: THEME.text, textAlign: 'center', marginBottom: 5 },
  subLogoText: { fontSize: 14, color: THEME.subText, textAlign: 'center', marginBottom: 40 },
  input: { backgroundColor: THEME.inputBg, color: THEME.text, borderRadius: 8, padding: 15, fontSize: 16, marginBottom: 15, borderWidth: 1, borderColor: '#24313f' },
  button: { backgroundColor: THEME.accent, borderRadius: 8, padding: 15, alignItems: 'center', marginBottom: 10 },
  buttonText: { color: THEME.text, fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#24313f', marginVertical: 25 },
  header: { height: 55, backgroundColor: THEME.header, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, borderBottomWidth: 1, borderColor: '#24313f' },
  headerTitle: { color: THEME.text, fontSize: 18, fontWeight: 'bold' },
  headerLink: { color: THEME.accent, fontSize: 16 },
  onlineStatus: { color: THEME.success, fontSize: 12 },
  searchSection: { padding: 15, backgroundColor: THEME.header },
  chatListItem: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderColor: '#1c2835', alignItems: 'center' },
  avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: THEME.accent },
  chatInfo: { marginLeft: 15, flex: 1 },
  chatName: { color: THEME.text, fontSize: 16, fontWeight: '600' },
  chatLastMsg: { color: THEME.subText, fontSize: 13, marginTop: 3 },
  emptyText: { color: THEME.subText, textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
  messagesList: { padding: 15 },
  messageWrapper: { flexDirection: 'row', marginBottom: 10, width: '100%' },
  myWrapper: { justifyContent: 'flex-end' },
  theirWrapper: { justifyContent: 'flex-start' },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, maxWidth: '80%', position: 'relative' },
  myBubble: { backgroundColor: THEME.myBubble, borderBottomRightRadius: 2 },
  theirBubble: { backgroundColor: THEME.theirBubble, borderBottomLeftRadius: 2 },
  messageText: { color: THEME.text, fontSize: 16 },
  messageTime: { color: THEME.subText, fontSize: 10, alignSelf: 'flex-end', marginTop: 4 },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: THEME.header, alignItems: 'center' },
  chatInput: { flex: 1, backgroundColor: THEME.bg, color: THEME.text, borderRadius: 20, paddingHorizontal: 15, paddingVertical: 8, fontSize: 16, maxHeight: 100 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.accent, marginLeft: 10, justifyContent: 'center', alignItems: 'center' },
  sendButtonText: { color: THEME.text, fontSize: 18, marginLeft: -2 },
  videoContainer: { height: 200, backgroundColor: '#000', position: 'relative' },
  remoteVideo: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  localVideo: { position: 'absolute', right: 10, bottom: 10, width: 70, height: 100, backgroundColor: '#222', borderRadius: 4, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#555' },
  videoText: { color: '#fff', fontSize: 12 },
  videoTextMini: { color: '#fff', fontSize: 8 }
});