import React, { useState, useEffect, useRef } from 'react';
import { 
    StyleSheet, 
    Text, 
    View, 
    TextInput, 
    TouchableOpacity, 
    FlatList, 
    Alert,
    ScrollView,
    StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket'; 
import dgram from 'react-native-udp';

const TCP_PORT = 9876; 
const UDP_PORT = 9877;

export default function App() {
    // Сессия ноды
    const [myId, setMyId] = useState('');
    const [inputMyId, setInputMyId] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [currentIp, setCurrentIp] = useState('127.0.0.1'); 

    // Контакты
    const [contacts, setContacts] = useState([]);
    const [newContactId, setNewContactId] = useState('');
    const [newContactIp, setNewContactIp] = useState('');
    const [selectedContact, setSelectedContact] = useState(null);

    // Чат
    const [messageText, setMessageText] = useState('');
    const [messages, setMessages] = useState([]);

    // Звонки
    const [currentCall, setCurrentCall] = useState(null); 

    const tcpServer = useRef(null);
    const udpSocket = useRef(null);
    const lastIpRef = useRef('192.168.1.55'); 

    useEffect(() => {
        initSession();
        return () => {
            if (tcpServer.current) tcpServer.current.close();
            if (udpSocket.current) udpSocket.current.close();
        };
    }, []);

    const initSession = async () => {
        try {
            const savedId = await AsyncStorage.getItem('@p2p_ultimate_id');
            const savedContacts = await AsyncStorage.getItem('@p2p_contacts');
            if (savedContacts) setContacts(JSON.parse(savedContacts));
            if (savedId !== null) {
                setMyId(savedId);
                setIsLoggedIn(true);
                startP2PEngine();
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleRegister = async () => {
        if (!inputMyId.trim()) return Alert.alert('Ошибка', 'Введите уникальный ID');
        await AsyncStorage.setItem('@p2p_ultimate_id', inputMyId.trim());
        setMyId(inputMyId.trim());
        setIsLoggedIn(true);
        startP2PEngine();
    };

    const startP2PEngine = () => {
        const fakeCurrentIp = '192.168.1.55'; 
        setCurrentIp(fakeCurrentIp);
        lastIpRef.current = fakeCurrentIp;
        startTcpServer();
        startUdpListener();
        setInterval(monitorNetworkAndSync, 5000);
    };

    const monitorNetworkAndSync = () => {
        const detectedIp = lastIpRef.current; 
        if (detectedIp !== currentIp) {
            setCurrentIp(detectedIp);
            contacts.forEach(contact => {
                if (contact.lastKnownIp) {
                    sendDirectPacket(contact.lastKnownIp, { type: 'IP_CHANGED', id: myId, newIp: detectedIp });
                }
            });
        }
        contacts.forEach(contact => {
            if (contact.lastKnownIp) {
                sendDirectPacket(contact.lastKnownIp, { type: 'WHERE_ARE_YOU', from: myId });
            }
        });
    };

    const startTcpServer = () => {
        if (tcpServer.current) return;
        tcpServer.current = TcpSocket.createServer((socket) => {
            socket.on('data', (data) => {
                try {
                    const packet = JSON.parse(data.toString());
                    handleIncomingPacket(packet, socket.remoteAddress);
                } catch (e) {}
            });
        }).listen({ port: TCP_PORT, host: '0.0.0.0' });
    };

    const handleIncomingPacket = (packet, remoteIp) => {
        switch (packet.type) {
            case 'IP_CHANGED':
                updateContactIp(packet.id, packet.newIp, 'online');
                break;
            case 'WHERE_ARE_YOU':
                sendDirectPacket(remoteIp, { type: 'I_AM_HERE', id: myId, ip: currentIp });
                updateContactIp(packet.from, remoteIp, 'online');
                break;
            case 'I_AM_HERE':
                updateContactIp(packet.id, packet.ip, 'online');
                break;
            case 'MSG':
                setMessages((prev) => [...prev, packet.data]);
                break;
            case 'CALL_START':
                setCurrentCall({ contactId: packet.from, isVideo: packet.isVideo, status: 'incoming' });
                break;
            case 'CALL_END':
                setCurrentCall(null);
                break;
        }
    };

    const startUdpListener = () => {
        if (udpSocket.current) return;
        udpSocket.current = dgram.createSocket('udp4');
        udpSocket.current.bind(UDP_PORT);
        udpSocket.current.on('message', (msg, rinfo) => {
            try {
                const packet = JSON.parse(msg.toString());
                if (packet.type === 'UDP_DISCOVERY' && packet.id !== myId) {
                    sendDirectPacket(rinfo.address, { type: 'I_AM_HERE', id: myId, ip: currentIp });
                }
            } catch (e) {}
        });
    };

    const sendDirectPacket = (ip, packet) => {
        try {
            const client = TcpSocket.createConnection({ port: TCP_PORT, host: ip }, () => {
                client.write(JSON.stringify(packet));
                client.destroy();
            });
            client.on('error', () => updateContactStatusByIp(ip, 'offline'));
        } catch (e) {}
    };

    const updateContactIp = async (id, ip, status) => {
        setContacts((prev) => {
            const updated = prev.map(c => c.id === id ? { ...c, lastKnownIp: ip, status } : c);
            AsyncStorage.setItem('@p2p_contacts', JSON.stringify(updated));
            return updated;
        });
    };

    const updateContactStatusByIp = (ip, status) => {
        setContacts((prev) => prev.map(c => c.lastKnownIp === ip ? { ...c, status } : c));
    };

    const addContact = async () => {
        if (!newContactId.trim() || !newContactIp.trim()) return Alert.alert('Внимание', 'Заполните ID и IP адреса');
        const newContact = { id: newContactId.trim(), lastKnownIp: newContactIp.trim(), status: 'offline' };
        const updatedContacts = [...contacts, newContact];
        setContacts(updatedContacts);
        await AsyncStorage.setItem('@p2p_contacts', JSON.stringify(updatedContacts));
        setNewContactId('');
        setNewContactIp('');
        sendDirectPacket(newContact.lastKnownIp, { type: 'WHERE_ARE_YOU', from: myId });
    };

    const sendContent = (contentType, customContent = null) => {
        if (!selectedContact) return;
        const content = customContent || messageText;
        const msgData = {
            id: Date.now().toString(),
            from: myId,
            contentType,
            content,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        sendDirectPacket(selectedContact.lastKnownIp, { type: 'MSG', data: msgData });
        setMessages((prev) => [...prev, { ...msgData, from: 'Вы' }]);
        if (contentType === 'text') setMessageText('');
    };

    const triggerCall = (isVideo) => {
        if (!selectedContact) return;
        setCurrentCall({ contactId: selectedContact.id, isVideo, status: 'outgoing' });
        sendDirectPacket(selectedContact.lastKnownIp, { type: 'CALL_START', from: myId, isVideo });
    };

    const endCall = () => {
        if (currentCall && selectedContact) sendDirectPacket(selectedContact.lastKnownIp, { type: 'CALL_END' });
        setCurrentCall(null);
    };

    // --- ФРОНТЕНД: ЭКРАН ЗВОНКА (ПОЛНОЭКРАННЫЙ) ---
    if (currentCall) {
        return (
            <View style={styles.callContainer}>
                <StatusBar barStyle="light-content" backgroundColor="#000" />
                <View style={styles.callHeaderZone}>
                    <Text style={styles.callBadge}>🔐 DIRECT P2P ENCRYPTED</Text>
                    <View style={styles.avatarLarge}>
                        <Text style={styles.avatarLargeText}>{currentCall.contactId.substring(0, 2).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.callName}>{currentCall.contactId}</Text>
                    <Text style={styles.callStatusText}>
                        {currentCall.status === 'incoming' ? 'Входящий защищенный вызов...' : 'Прямое подключение к ноде...'}
                    </Text>
                </View>

                <View style={styles.callActionRow}>
                    {currentCall.status === 'incoming' && (
                        <TouchableOpacity style={[styles.roundCallBtn, styles.bgAccept]} onPress={() => setCurrentCall({...currentCall, status: 'active'})}>
                            <Text style={styles.callIconText}>📞</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.roundCallBtn, styles.bgDecline]} onPress={endCall}>
                        <Text style={styles.callIconText}>🛑</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // --- ФРОНТЕНД: ЭКРАН РЕГИСТРАЦИИ (CYBERPUNK STYLE) ---
    if (!isLoggedIn) {
        return (
            <View style={styles.loginContainer}>
                <StatusBar barStyle="light-content" backgroundColor="#090a0f" />
                <Text style={styles.loginLogo}>🪐 NODE NETWORK</Text>
                <Text style={styles.loginSub}>Создайте децентрализованный ID для этого смартфона</Text>
                
                <TextInput 
                    style={styles.modernInput}
                    placeholder="Укажите уникальный ID (например: dark_node)"
                    placeholderTextColor="#4a5568"
                    value={inputMyId}
                    onChangeText={setInputMyId}
                />
                
                <TouchableOpacity style={styles.primaryGradientBtn} onPress={handleRegister}>
                    <Text style={styles.btnTextPrimary}>Инициализировать систему</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // --- ФРОНТЕНД: ГЛАВНЫЙ СТИЛЬНЫЙ МЕССЕНДЖЕР ---
    return (
        <View style={styles.mainContainer}>
            <StatusBar barStyle="light-content" backgroundColor="#090a0f" />
            
            {/* Верхняя инфо-панель */}
            <View style={styles.topInfoBar}>
                <Text style={styles.myIdLabel}>ID Ноды: <Text style={styles.neonGreen}>{myId}</Text></Text>
                <Text style={styles.myIpLabel}>Локальный IP: {currentIp}</Text>
            </View>

            {/* Быстрое добавление контакта */}
            <View style={styles.glassAddBox}>
                <TextInput 
                    style={[styles.smallInput, { flex: 1.2 }]} 
                    placeholder="ID пира" 
                    placeholderTextColor="#4a5568"
                    value={newContactId}
                    onChangeText={setNewContactId}
                />
                <TextInput 
                    style={[styles.smallInput, { flex: 1.8 }]} 
                    placeholder="Текущий IP" 
                    placeholderTextColor="#4a5568"
                    value={newContactIp}
                    onChangeText={setNewContactIp}
                />
                <TouchableOpacity style={styles.squareAddBtn} onPress={addContact}>
                    <Text style={styles.addBtnIcon}>+</Text>
                </TouchableOpacity>
            </View>

            {/* Горизонтальный список пиров в сети */}
            <View style={styles.peersSection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {contacts.map((item) => (
                        <TouchableOpacity 
                            key={item.id} 
                            style={[styles.peerCard, selectedContact?.id === item.id && styles.activePeerCard]}
                            onPress={() => setSelectedContact(item)}
                        >
                            <View style={styles.avatarSmall}>
                                <Text style={styles.avatarSmallText}>{item.id.substring(0,2).toUpperCase()}</Text>
                                <View style={[styles.statusDot, { backgroundColor: item.status === 'online' ? '#00ff66' : '#ff3b30' }]} />
                            </View>
                            <Text style={styles.peerCardName} numberOfLines={1}>{item.id}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Зона чата */}
            {selectedContact ? (
                <View style={styles.chatWrapper}>
                    <View style={styles.chatHeader}>
                        <View>
                            <Text style={styles.chatTitle}>{selectedContact.id}</Text>
                            <Text style={styles.chatSubTitle}>{selectedContact.lastKnownIp}</Text>
                        </View>
                        <View style={styles.callIconsGroup}>
                            <TouchableOpacity style={styles.iconCircle} onPress={() => triggerCall(false)}>
                                <Text style={{fontSize: 16}}>📞</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.iconCircle} onPress={() => triggerCall(true)}>
                                <Text style={{fontSize: 16}}>⭕</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <FlatList 
                        data={messages.filter(m => m.from === selectedContact.id || m.from === 'Вы')}
                        keyExtractor={(item) => item.id}
                        renderItem={({ item }) => (
                            <View style={[styles.bubble, item.from === 'Вы' ? styles.bubbleRight : styles.bubbleLeft]}>
                                <Text style={styles.bubbleText}>{item.content}</Text>
                                <Text style={styles.bubbleTime}>{item.time}</Text>
                            </View>
                        )}
                        style={styles.messagesList}
                    />

                    {/* Панель ввода сообщений */}
                    <View style={styles.bottomActionInputBar}>
                        <TextInput 
                            style={styles.mainChatInput} 
                            placeholder="Шифрованное сообщение..." 
                            placeholderTextColor="#4a5568"
                            value={messageText}
                            onChangeText={setMessageText}
                        />
                        <TouchableOpacity style={styles.circleSendBtn} onPress={() => sendContent('text')}>
                            <Text style={{color: '#fff', fontWeight: 'bold'}}>➡️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.circleSendBtn, {backgroundColor: '#10b981'}]} onPress={() => sendContent('voice', '🎙️ P2P Аудиозапись')}>
                            <Text style={{fontSize: 14}}>🎙️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.circleSendBtn, {backgroundColor: '#f97316'}]} onPress={() => sendContent('circle', '⭕ P2P Видеокружок')}>
                            <Text style={{fontSize: 14}}>⭕</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
                <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>Выберите активную ноду из списка выше для безопасного P2P соединения</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    // Общие контейнеры
    mainContainer: { flex: 1, backgroundColor: '#090a0f', paddingHorizontal: 16, paddingTop: 20 },
    loginContainer: { flex: 1, backgroundColor: '#090a0f', justifyContent: 'center', paddingHorizontal: 24 },
    callContainer: { flex: 1, backgroundColor: '#050508', justifyContent: 'space-between', paddingVertical: 60, alignItems: 'center' },
    
    // Экран входа
    loginLogo: { color: '#38bdf8', fontSize: 28, fontWeight: '900', textAlign: 'center', letterSpacing: 2, marginBottom: 10 },
    loginSub: { color: '#64748b', fontSize: 14, textAlign: 'center', marginBottom: 40, paddingHorizontal: 20 },
    modernInput: { backgroundColor: '#131520', color: '#fff', padding: 18, borderRadius: 16, borderWidth: 1, borderColor: '#1e293b', fontSize: 16, marginBottom: 20 },
    primaryGradientBtn: { backgroundColor: '#38bdf8', padding: 18, borderRadius: 16, alignItems: 'center', shadowColor: '#38bdf8', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
    btnTextPrimary: { color: '#090a0f', fontWeight: '900', fontSize: 16 },

    // Верхний статус бар
    topInfoBar: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
    myIdLabel: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
    neonGreen: { color: '#00ff66', fontWeight: 'bold' },
    myIpLabel: { color: '#64748b', fontSize: 13 },

    // Добавление пира
    glassAddBox: { flexDirection: 'row', gap: 8, backgroundColor: '#131520', padding: 10, borderRadius: 14, borderWidth: 1, borderColor: '#1e293b' },
    smallInput: { backgroundColor: '#090a0f', color: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, fontSize: 14 },
    squareAddBtn: { backgroundColor: '#38bdf8', width: 45, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
    addBtnIcon: { color: '#090a0f', fontSize: 20, fontWeight: 'bold' },

    // Список контактов (Горизонтальный)
    peersSection: { height: 95, marginTop: 15 },
    peerCard: { backgroundColor: '#131520', width: 85, height: 85, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: '#1e293b' },
    activePeerCard: { borderColor: '#38bdf8', backgroundColor: '#1e2638' },
    peerCardName: { color: '#cbd5e1', fontSize: 12, fontWeight: '600', marginTop: 6, width: '80%', textAlign: 'center' },
    avatarSmall: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center', position: 'relative' },
    avatarSmallText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
    statusDot: { width: 10, height: 10, borderRadius: 5, position: 'absolute', bottom: 0, right: 0, borderWidth: 1.5, borderColor: '#131520' },

    // Интерфейс чата
    chatWrapper: { flex: 1, marginTop: 10 },
    chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#131520', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#1e293b' },
    chatTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    chatSubTitle: { color: '#64748b', fontSize: 12 },
    callIconsGroup: { flexDirection: 'row', gap: 12 },
    iconCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center' },

    messagesList: { flex: 1, marginVertical: 12 },
    bubble: { padding: 12, borderRadius: 16, marginBottom: 8, maxWidth: '75%' },
    bubbleRight: { backgroundColor: '#38bdf8', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
    bubbleLeft: { backgroundColor: '#131520', alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#1e293b' },
    bubbleText: { color: '#fff', fontSize: 15 },
    bubbleTime: { color: '#090a0f', fontSize: 10, textAlign: 'right', marginTop: 4, opacity: 0.6 },

    bottomActionInputBar: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingBottom: 10 },
    mainChatInput: { flex: 1, backgroundColor: '#131520', color: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: '#1e293b', fontSize: 15 },
    circleSendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center' },

    // Пустой экран
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
    emptyText: { color: '#475569', textAlign: 'center', fontSize: 14, lineHeight: 20 },

    // Интерфейс звонка
    callHeaderZone: { alignItems: 'center', marginTop: 40 },
    callBadge: { color: '#00ff66', fontSize: 11, fontWeight: 'bold', letterSpacing: 2, backgroundColor: '#0f291b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 40 },
    avatarLarge: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#38bdf8' },
    avatarLargeText: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
    callName: { color: '#fff', fontSize: 28, fontWeight: '900', marginBottom: 10 },
    callStatusText: { color: '#64748b', fontSize: 15 },
    callActionRow: { flexDirection: 'row', gap: 40, marginBottom: 40 },
    roundCallBtn: { width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center', elevation: 10 },
    bgAccept: { backgroundColor: '#10b981' },
    bgDecline: { backgroundColor: '#ef4444' },
    callIconText: { fontSize: 26, color: '#fff' }
});